import { SIGNALING_URL } from "./config.js";
import { WebRtcAudio } from "./webrtc.js";
import { TcpAudio, makeInvite, parseInvite } from "./tcp-audio.js";

const $ = id => document.getElementById(id);
const els = {
  create: $("create-room"),
  join: $("join-room"),
  code: $("invite-code"),
  invitePanel: $("invite-panel"),
  inviteLink: $("invite-link"),
  displayCode: $("display-code"),
  copyLink: $("copy-link"),
  copyCode: $("copy-code"),
  indicator: $("connection-indicator"),
  statusIcon: $("status-icon"),
  statusTitle: $("status-title"),
  statusText: $("status-text"),
  transport: $("transport-label"),
  tcp: $("tcp-fallback"),
  hangup: $("hangup"),
  audio: $("remote-audio"),
  error: $("error-message"),
  debugLog: $("debug-log"),
  debugUrl: $("debug-url"),
  debugState: $("debug-state")
};

function debug(message) {
  if (!els.debugLog) return;
  const time = new Date().toLocaleTimeString("ru-RU", { hour12: false });
  const line = "[" + time + "] " + message;
  els.debugLog.textContent = (els.debugLog.textContent + "\\n" + line).trim();
  els.debugLog.scrollTop = els.debugLog.scrollHeight;
}

function updateDebugState(ws) {
  if (els.debugState) {
    const names = ["CONNECTING", "OPEN", "CLOSING", "CLOSED"];
    els.debugState.textContent = names[ws.readyState] || String(ws.readyState);
  }
}

const state = {
  roomId: null,
  secret: null,
  ws: null,
  role: null,
  peerPresent: false,
  webrtc: null,
  tcp: null,
  mode: "webrtc",
  mediaStarting: false
};

function setStatus(title, text, kind = "idle") {
  els.statusTitle.textContent = title;
  els.statusText.textContent = text;
  els.indicator.className = "status-pill status-" + kind;
  els.indicator.textContent = ({ idle: "Не подключено", wait: "Ожидание", live: "На связи", error: "Проблема" })[kind] || kind;
  els.statusIcon.textContent = kind === "live" ? "♫" : kind === "error" ? "!" : "⌁";
}

function showError(message) {
  els.error.textContent = message;
  els.error.classList.remove("hidden");
}
function clearError() {
  els.error.textContent = "";
  els.error.classList.add("hidden");
}
function setBusy(busy) {
  els.create.disabled = busy;
  els.join.disabled = busy;
}
function setRoomInAddress(roomId, secret) {
  const url = new URL(location.href);
  url.searchParams.set("room", roomId);
  url.hash = "key=" + btoa(String.fromCharCode(...secret)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  history.replaceState(null, "", url);
}

function currentInviteLink() {
  return location.href;
}

function updateInvite(roomId, secret) {
  const code = makeInvite(roomId, secret);
  setRoomInAddress(roomId, secret);
  els.inviteLink.value = currentInviteLink();
  els.displayCode.value = code;
  els.invitePanel.classList.remove("hidden");
}

async function copyValue(value, button) {
  try {
    await navigator.clipboard.writeText(value);
    const old = button.textContent;
    button.textContent = "Скопировано";
    setTimeout(() => button.textContent = old, 1400);
  } catch {
    showError("Не удалось скопировать автоматически. Выделите поле и скопируйте его вручную.");
  }
}

function signalingUrl(roomId) {
  if (SIGNALING_URL.includes("YOUR_SUBDOMAIN")) {
    throw new Error("Сначала настройте адрес Cloudflare Worker в js/config.js (SIGNALING_URL).");
  }
  return SIGNALING_URL.replace(/\/$/, "") + "/ws/" + roomId;
}

function sendJson(message) {
  if (state.ws?.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify(message));
}

async function joinRoom(roomId, secret) {
  clearError();
  if (!/^([a-f0-9]{32})$/.test(roomId) || secret.length !== 32) {
    showError("Некорректный идентификатор комнаты или ключ.");
    return;
  }
  if (state.ws && state.ws.readyState <= WebSocket.OPEN) {
    showError("Сначала завершите текущее подключение.");
    return;
  }

  state.roomId = roomId;
  state.secret = secret;
  setBusy(true);
  setStatus("Подключаемся к комнате", "Открываем защищённое WebSocket-соединение с signaling-сервером.", "wait");

  let url;
  try { url = signalingUrl(roomId); }
  catch (error) { setBusy(false); showError(error.message); setStatus("Не настроен сервер", error.message, "error"); return; }

  if (els.debugUrl) els.debugUrl.textContent = url;
  debug("Начинаем WebSocket-подключение");
  debug("URL: " + url);

  try {
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    state.ws = ws;
    updateDebugState(ws);
    debug("WebSocket создан; readyState=" + ws.readyState);

    ws.onopen = () => {
      updateDebugState(ws);
      debug("СОЕДИНЕНИЕ ОТКРЫТО (onopen); readyState=" + ws.readyState);
      els.hangup.disabled = false;
      setBusy(false);
      setStatus("Подключено к комнате", "Ожидаем второго участника. Не закрывайте эту страницу.", "wait");
    };

    ws.onmessage = event => {
      if (typeof event.data !== "string") {
        state.tcp?.receive(event.data);
        return;
      }
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      handleServerMessage(message).catch(error => showError(error.message));
    };

    ws.onerror = () => {
      updateDebugState(ws);
      debug("ОШИБКА WebSocket (onerror); readyState=" + ws.readyState + ". Браузер не раскрывает HTTP-статус handshake.");
      showError("Ошибка WebSocket. Проверьте адрес Worker и доступность Cloudflare из этой сети.");
    };
    ws.onclose = event => {
      updateDebugState(ws);
      debug("СОЕДИНЕНИЕ ЗАКРЫТО (onclose): code=" + event.code +
        ", reason=" + (event.reason || "(пусто)") +
        ", wasClean=" + event.wasClean +
        ", readyState=" + ws.readyState);
      if (state.ws === ws) {
        setBusy(false);
        els.hangup.disabled = true;
        setStatus("Соединение закрыто", "Комната больше не подключена.", "idle");
      }
    };
  } catch (error) {
    debug("ИСКЛЮЧЕНИЕ при создании WebSocket: " + error.name + ": " + error.message);
    setBusy(false);
    showError(error.message);
  }
}

async function handleServerMessage(message) {
  if (message.type === "joined") {
    state.role = message.role;
    state.peerPresent = message.peerCount > 1;
    setStatus("Комната готова", state.peerPresent ? "Оба участника подключены." : "Отправьте приглашение другу и дождитесь его подключения.", "wait");
    if (state.peerPresent && state.role === "initiator") await startWebRtcOffer();
    return;
  }

  if (message.type === "peer-joined") {
    state.peerPresent = true;
    setStatus("Друг подключился", "Согласовываем прямое аудиосоединение.", "wait");
    if (state.role === "initiator" && state.mode === "webrtc") await startWebRtcOffer();
    return;
  }

  if (message.type === "peer-left") {
    state.peerPresent = false;
    setStatus("Собеседник отключился", "Можно дождаться повторного подключения.", "wait");
    return;
  }

  if (message.type === "signal" && state.mode === "webrtc") {
    await ensureWebRtc();
    await state.webrtc.handleSignal(message.payload || {});
    return;
  }

  if (message.type === "mode" && message.mode === "tcp") {
    await startTcpAudio(false);
    return;
  }

  if (message.type === "error") {
    showError(message.message || "Ошибка комнаты.");
  }
}

async function ensureWebRtc() {
  if (!state.webrtc) {
    state.webrtc = new WebRtcAudio({
      sendSignal: payload => sendJson({ type: "signal", payload }),
      onRemoteStream: stream => {
        els.audio.srcObject = stream;
        els.audio.play().catch(() => {});
      },
      onState: value => {
        if (value === "connected") {
          state.mode = "webrtc";
          els.transport.textContent = "Прямой WebRTC / P2P";
          els.tcp.classList.add("hidden");
          setStatus("Вы на связи", "Аудио передаётся напрямую между устройствами.", "live");
        } else if (value === "failed") {
          els.transport.textContent = "Прямое соединение не установлено";
          els.tcp.classList.remove("hidden");
          setStatus("P2P не получилось", "Можно попробовать TCP-аудио через сервер.", "error");
        } else if (value === "connecting" || value === "checking") {
          setStatus("Проверяем прямое соединение", "ICE проверяет доступные сетевые маршруты.", "wait");
        }
      }
    });
  }
}

async function startWebRtcOffer() {
  try {
    await ensureWebRtc();
    await state.webrtc.createOffer();
  } catch (error) {
    showError("Не удалось запустить WebRTC: " + error.message);
    els.tcp.classList.remove("hidden");
  }
}

async function startTcpAudio(notifyPeer) {
  clearError();
  if (!state.peerPresent) {
    showError("Сначала дождитесь подключения второго участника.");
    return;
  }
  if (state.tcp) return;

  try {
    await ensureWebRtc();
    const stream = await state.webrtc.ensureMedia();
    await state.webrtc.close();
    state.mode = "tcp";
    if (notifyPeer) sendJson({ type: "mode", mode: "tcp" });

    state.tcp = new TcpAudio({
      ws: state.ws,
      roomId: state.roomId,
      secret: state.secret,
      role: state.role,
      stream,
      onState: message => {
        els.transport.textContent = "TCP / WebSocket · зашифрованный PCM";
        setStatus("Вы на связи", message, "live");
      }
    });
    await state.tcp.start();
    els.audio.srcObject = null;
    els.tcp.classList.add("hidden");
  } catch (error) {
    showError("Не удалось запустить TCP-аудио: " + error.message);
  }
}

async function hangup() {
  if (state.tcp) {
    await state.tcp.stop();
    state.tcp = null;
  }
  if (state.webrtc) {
    await state.webrtc.close({ stopTracks: true });
    state.webrtc = null;
  }
  if (state.ws) {
    const ws = state.ws;
    state.ws = null;
    ws.close(1000, "hangup");
  }
  els.audio.srcObject = null;
  els.tcp.classList.add("hidden");
  els.hangup.disabled = true;
  els.transport.textContent = "Не выбран";
  setBusy(false);
  setStatus("Звонок завершён", "Создайте новую комнату или подключитесь снова.", "idle");
}

els.create.addEventListener("click", async () => {
  const roomId = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, "0")).join("");
  const secret = crypto.getRandomValues(new Uint8Array(32));
  updateInvite(roomId, secret);
  await joinRoom(roomId, secret);
});

els.join.addEventListener("click", async () => {
  try {
    const invite = parseInvite(els.code.value);
    updateInvite(invite.roomId, invite.secret);
    await joinRoom(invite.roomId, invite.secret);
  } catch (error) {
    showError(error.message);
  }
});

els.copyLink.addEventListener("click", () => copyValue(els.inviteLink.value, els.copyLink));
els.copyCode.addEventListener("click", () => copyValue(els.displayCode.value, els.copyCode));
els.tcp.addEventListener("click", () => startTcpAudio(true));
els.hangup.addEventListener("click", hangup);

const initialUrl = new URL(location.href);
const initialRoom = initialUrl.searchParams.get("room");
const initialKey = initialUrl.hash.match(/(?:^#|&)key=([^&]+)/);
if (initialRoom && initialKey) {
  els.code.value = location.href;
  setStatus("Получено приглашение", "Нажмите «Войти», чтобы подключиться к комнате.", "wait");
}
