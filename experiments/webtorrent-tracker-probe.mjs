import WebSocket from "ws";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";

const TRACKERS = (process.env.TRACKERS ||
  "wss://tracker.openwebtorrent.com,wss://tracker.webtorrent.dev")
  .split(",").map((s) => s.trim()).filter(Boolean);

const TIMEOUT_MS = 12000;
const ROOM_COUNT = 3;
const PAYLOAD_BYTES = 1024;

function binaryString(buffer) {
  return Array.from(buffer, (byte) => String.fromCharCode(byte)).join("");
}

function roomHash(index) {
  // Sequential input values, independently mapped to 20-byte BitTorrent info_hashes.
  return binaryString(createHash("sha256").update(String(index + 1)).digest().subarray(0, 20));
}

function peerId(label) {
  return binaryString(createHash("sha256").update("voicelink-ws-probe:" + label).digest().subarray(0, 20));
}

function waitForOpen(ws, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label + " open timeout")), TIMEOUT_MS);
    ws.once("open", () => { clearTimeout(timer); resolve(); });
    ws.once("error", (error) => { clearTimeout(timer); reject(error); });
    ws.once("unexpected-response", (_req, response) => {
      clearTimeout(timer);
      reject(new Error(label + " HTTP " + response.statusCode));
    });
  });
}

function waitForMessage(ws, predicate, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(label + " timeout"));
    }, TIMEOUT_MS);
    const onMessage = (raw) => {
      let message;
      try { message = JSON.parse(raw.toString()); } catch { return; }
      if (!predicate(message)) return;
      cleanup();
      resolve(message);
    };
    const onError = (error) => { cleanup(); reject(error); };
    const onClose = (code, reason) => {
      cleanup();
      reject(new Error(label + " socket closed: " + code + " " + reason.toString()));
    };
    function cleanup() {
      clearTimeout(timer);
      ws.off("message", onMessage);
      ws.off("error", onError);
      ws.off("close", onClose);
    }
    ws.on("message", onMessage);
    ws.on("error", onError);
    ws.on("close", onClose);
  });
}

function send(ws, message) {
  ws.send(JSON.stringify(message));
}

async function probeTracker(url) {
  console.log("\n=== Tracker: " + url + " ===");
  const sender = new WebSocket(url, { handshakeTimeout: TIMEOUT_MS });
  const receiver = new WebSocket(url, { handshakeTimeout: TIMEOUT_MS });

  try {
    await Promise.all([waitForOpen(sender, "sender"), waitForOpen(receiver, "receiver")]);
    console.log("PASS: two independent WebSocket peers connected from the same GitHub Actions runner.");

    const senderId = peerId("sender");
    const receiverId = peerId("receiver");
    const results = [];

    for (let i = 0; i < ROOM_COUNT; i++) {
      const hash = roomHash(i);
      const hashKey = Buffer.from(hash, "latin1").toString("hex");
      const offerId = binaryString(createHash("sha256").update("offer:" + (i + 1)).digest().subarray(0, 20));

      const receiverAck = waitForMessage(
        receiver,
        (m) => m.action === "announce" && m.info_hash === hash,
        "receiver announce ack for room " + (i + 1)
      );
      send(receiver, {
        action: "announce", info_hash: hash, peer_id: receiverId,
        uploaded: 0, downloaded: 0, left: 1, event: "started", numwant: 0
      });
      await receiverAck;

      const payload = Buffer.alloc(PAYLOAD_BYTES);
      for (let n = 0; n < payload.length; n++) payload[n] = (n * 31 + i * 17) & 0xff;
      const payloadBase64 = payload.toString("base64");
      const marker = "a=x-voicelink-probe:" + (i + 1) + ":" + payloadBase64;
      const syntheticSdp = [
        "v=0",
        "o=- 1 1 IN IP4 127.0.0.1",
        "s=VoiceLink tracker transport probe",
        "t=0 0",
        marker,
        ""
      ].join("\r\n");

      const relayPromise = waitForMessage(
        receiver,
        (m) => m.action === "announce" &&
          m.info_hash === hash &&
          m.offer &&
          m.offer.sdp &&
          m.offer.sdp.includes("a=x-voicelink-probe:" + (i + 1) + ":"),
        "offer relay for room " + (i + 1)
      );

      const startedAt = performance.now();
      const senderAck = waitForMessage(
        sender,
        (m) => m.action === "announce" && m.info_hash === hash,
        "sender announce ack for room " + (i + 1)
      );

      send(sender, {
        action: "announce",
        info_hash: hash,
        peer_id: senderId,
        uploaded: 0,
        downloaded: 0,
        left: 1,
        event: "started",
        numwant: 1,
        offers: [{ offer: { type: "offer", sdp: syntheticSdp }, offer_id: offerId }]
      });

      await senderAck;
      const relayed = await relayPromise;
      const elapsedMs = Math.round(performance.now() - startedAt);
      const expectedMarker = "a=x-voicelink-probe:" + (i + 1) + ":" + payloadBase64;
      if (!relayed.offer.sdp.includes(expectedMarker)) {
        throw new Error("room " + (i + 1) + ": payload mismatch");
      }

      const receivedPayload = relayed.offer.sdp.split(expectedMarker)[1];
      if (receivedPayload === undefined) throw new Error("room " + (i + 1) + ": marker missing");
      results.push({ room: i + 1, infoHash: hashKey, payloadBytes: payload.length, relayMs: elapsedMs });
      console.log("PASS: room " + (i + 1) + " relayed " + payload.length + " bytes in " + elapsedMs + " ms");
    }

    // Sustained one-way probe: 1 KiB payloads at 25 messages/second in one room.
    const streamHash = roomHash(ROOM_COUNT + 1);
    const streamHashKey = Buffer.from(streamHash, "latin1").toString("hex");
    const joinStreamRoom = waitForMessage(
      receiver,
      (m) => m.action === "announce" && m.info_hash === streamHash,
      "receiver stream-room announce ack"
    );
    send(receiver, {
      action: "announce", info_hash: streamHash, peer_id: receiverId,
      uploaded: 0, downloaded: 0, left: 1, event: "started", numwant: 0
    });
    await joinStreamRoom;

    const streamPackets = 125;
    const streamIntervalMs = 40;
    const sentAt = new Map();
    const receivedAt = new Map();
    const streamPayload = Buffer.alloc(PAYLOAD_BYTES, 0x5a);
    const streamListener = (raw) => {
      let message;
      try { message = JSON.parse(raw.toString()); } catch { return; }
      if (message.action !== "announce" || message.info_hash !== streamHash || !message.offer?.sdp) return;
      const markerLine = message.offer.sdp.split("\\r\\n").find((line) => line.startsWith("a=x-voicelink-stream:"));
      if (!markerLine) return;
      const markerParts = markerLine.slice("a=x-voicelink-stream:".length).split(":");
      if (markerParts.length !== 2) return;
      const packetNumber = Number(markerParts[0]);
      if (!sentAt.has(packetNumber) || receivedAt.has(packetNumber)) return;
      const decoded = Buffer.from(markerParts[1], "base64");
      if (decoded.length !== PAYLOAD_BYTES || !decoded.equals(streamPayload)) return;
      receivedAt.set(packetNumber, performance.now());
    };
    receiver.on("message", streamListener);

    const streamStarted = performance.now();
    for (let i = 0; i < streamPackets; i++) {
      const offerId = binaryString(createHash("sha256").update("stream-offer:" + i).digest().subarray(0, 20));
      const marker = "a=x-voicelink-stream:" + i + ":" + streamPayload.toString("base64");
      const sdp = ["v=0", "o=- 2 2 IN IP4 127.0.0.1", "s=VoiceLink stream probe", "t=0 0", marker, ""].join("\\r\\n");
      sentAt.set(i, performance.now());
      send(sender, {
        action: "announce", info_hash: streamHash, peer_id: senderId,
        uploaded: 0, downloaded: 0, left: 1, event: i === 0 ? "started" : "update", numwant: 1,
        offers: [{ offer: { type: "offer", sdp }, offer_id: offerId }]
      });
      if (i + 1 < streamPackets) await new Promise((resolve) => setTimeout(resolve, streamIntervalMs));
    }

    await new Promise((resolve) => setTimeout(resolve, 2500));
    receiver.off("message", streamListener);
    const latencies = Array.from(receivedAt, ([packet, received]) => received - sentAt.get(packet)).sort((a, b) => a - b);
    const percentile = (p) => latencies.length ? Math.round(latencies[Math.min(latencies.length - 1, Math.floor((latencies.length - 1) * p))]) : null;
    const streamResult = {
      room: streamHashKey,
      payloadBytes: PAYLOAD_BYTES,
      targetRatePerSecond: 1000 / streamIntervalMs,
      sentPackets: streamPackets,
      receivedPackets: receivedAt.size,
      lostPackets: streamPackets - receivedAt.size,
      lossPercent: Number(((streamPackets - receivedAt.size) / streamPackets * 100).toFixed(2)),
      elapsedMs: Math.round(performance.now() - streamStarted),
      latencyMs: { min: latencies.length ? Math.round(latencies[0]) : null, median: percentile(0.5), p95: percentile(0.95), max: latencies.length ? Math.round(latencies[latencies.length - 1]) : null }
    };
    console.log("STREAM " + JSON.stringify(streamResult));

    console.log("\\nRESULT " + JSON.stringify({ tracker: url, rooms: results, stream: streamResult, sameRunnerIp: true }));
    return true;
  } finally {
    for (const ws of [sender, receiver]) {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        try { ws.close(); } catch {}
      }
    }
  }
}

let passed = false;
const failures = [];
for (const tracker of TRACKERS) {
  try {
    if (await probeTracker(tracker)) { passed = true; break; }
  } catch (error) {
    console.error("FAIL:", tracker, error.message);
    failures.push({ tracker, error: error.message });
  }
}

if (!passed) {
  console.error("\nAll public trackers failed:", JSON.stringify(failures));
  process.exit(1);
}
