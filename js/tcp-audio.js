const TARGET_RATE = 16000;
const FRAME_SAMPLES = 1600; // 100 ms

function fromBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, ch => ch.charCodeAt(0));
}

function toBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function deriveAesKey(secret, roomId, direction) {
  const material = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new TextEncoder().encode(roomId),
      info: new TextEncoder().encode("voice-link-v1:" + direction)
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export function makeInvite(roomId, secret) {
  const roomBytes = Uint8Array.from(roomId.match(/.{2}/g), x => parseInt(x, 16));
  const combined = new Uint8Array(roomBytes.length + secret.length);
  combined.set(roomBytes, 0);
  combined.set(secret, roomBytes.length);
  return toBase64Url(combined);
}

export function parseInvite(value) {
  const trimmed = value.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    const url = new URL(trimmed);
    const roomId = url.searchParams.get("room");
    const keyMatch = url.hash.match(/(?:^#|&)key=([^&]+)/);
    if (!roomId || !keyMatch) throw new Error("В ссылке нет комнаты или ключа приглашения.");
    const secret = fromBase64Url(decodeURIComponent(keyMatch[1]));
    if (!/^[a-f0-9]{32}$/i.test(roomId) || secret.length !== 32) throw new Error("Некорректная ссылка-приглашение.");
    return { roomId: roomId.toLowerCase(), secret };
  }

  const bytes = fromBase64Url(trimmed);
  if (bytes.length !== 48) throw new Error("Код должен содержать 64 символа или быть ссылкой-приглашением.");
  const roomId = Array.from(bytes.slice(0, 16), b => b.toString(16).padStart(2, "0")).join("");
  return { roomId, secret: bytes.slice(16) };
}

export class TcpAudio {
  constructor({ ws, roomId, secret, role, stream, onState }) {
    this.ws = ws;
    this.roomId = roomId;
    this.secret = secret;
    this.role = role;
    this.stream = stream;
    this.onState = onState || (() => {});
    this.audioContext = null;
    this.source = null;
    this.captureNode = null;
    this.muteGain = null;
    this.sendKey = null;
    this.receiveKey = null;
    this.counter = 0n;
    this.noncePrefix = crypto.getRandomValues(new Uint8Array(4));
    this.nextPlayTime = 0;
    this.closed = false;
    this.lastReceivedCounter = -1n;
  }

  async start() {
    const sendDirection = this.role === "initiator" ? "A-to-B" : "B-to-A";
    const receiveDirection = this.role === "initiator" ? "B-to-A" : "A-to-B";
    [this.sendKey, this.receiveKey] = await Promise.all([
      deriveAesKey(this.secret, this.roomId, sendDirection),
      deriveAesKey(this.secret, this.roomId, receiveDirection)
    ]);

    this.audioContext = new AudioContext();
    await this.audioContext.audioWorklet.addModule("./js/pcm-worklet.js");
    await this.audioContext.resume();

    this.source = this.audioContext.createMediaStreamSource(this.stream);
    this.captureNode = new AudioWorkletNode(this.audioContext, "pcm-capture");
    this.muteGain = this.audioContext.createGain();
    this.muteGain.gain.value = 0;
    this.source.connect(this.captureNode);
    this.captureNode.connect(this.muteGain);
    this.muteGain.connect(this.audioContext.destination);

    this.captureNode.port.onmessage = event => {
      if (this.closed || this.ws.readyState !== WebSocket.OPEN) return;
      this.sendFrame(event.data).catch(error => this.onState("Ошибка шифрования TCP-аудио: " + error.message));
    };

    this.onState("TCP-аудио активно · PCM 16 кГц · шифрование AES-GCM");
  }

  async sendFrame(pcmBuffer) {
    const counter = this.counter++;
    const nonce = new Uint8Array(12);
    nonce.set(this.noncePrefix, 0);
    new DataView(nonce.buffer).setBigUint64(4, counter, false);

    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce },
      this.sendKey,
      pcmBuffer
    );

    const packet = new Uint8Array(12 + encrypted.byteLength);
    packet.set(nonce, 0);
    packet.set(new Uint8Array(encrypted), 12);
    if (this.ws.readyState === WebSocket.OPEN && packet.byteLength <= 8192) {
      this.ws.send(packet);
    }
  }

  async receive(packet) {
    if (this.closed || !this.receiveKey || !(packet instanceof ArrayBuffer) || packet.byteLength < 28) return;
    const bytes = new Uint8Array(packet);
    const nonce = bytes.slice(0, 12);
    const counter = new DataView(nonce.buffer).getBigUint64(4, false);
    if (counter <= this.lastReceivedCounter) return;

    try {
      const decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: nonce },
        this.receiveKey,
        bytes.slice(12)
      );
      this.lastReceivedCounter = counter;
      this.playFrame(new Int16Array(decrypted));
    } catch {
      // Invalid authentication tag or packet: discard without exposing audio.
    }
  }

  playFrame(samples) {
    if (!this.audioContext || this.audioContext.state === "closed") return;
    const buffer = this.audioContext.createBuffer(1, samples.length, TARGET_RATE);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) {
      channel[i] = samples[i] < 0 ? samples[i] / 32768 : samples[i] / 32767;
    }

    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(this.audioContext.destination);

    const now = this.audioContext.currentTime;
    if (this.nextPlayTime < now + 0.04 || this.nextPlayTime > now + 0.5) {
      this.nextPlayTime = now + 0.12;
    }
    source.start(this.nextPlayTime);
    this.nextPlayTime += buffer.duration;
  }

  async stop() {
    this.closed = true;
    try { this.source?.disconnect(); } catch {}
    try { this.captureNode?.disconnect(); } catch {}
    try { this.muteGain?.disconnect(); } catch {}
    if (this.audioContext && this.audioContext.state !== "closed") {
      await this.audioContext.close();
    }
  }
}
