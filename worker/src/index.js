const ROOM_ID_RE = /^[a-f0-9]{32}$/;
const ALLOWED_ORIGINS = new Set([
  "https://aiparticles-jpg.github.io",
  "https://minitool.io"
]);
const MAX_SIGNAL_BYTES = 16 * 1024;
const MAX_AUDIO_FRAME_BYTES = 8 * 1024;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({ ok: true, service: "p2p-voice-signaling" });
    }

    const match = url.pathname.match(/^\/ws\/([a-f0-9]{32})$/);
    if (!match) return new Response("Not found", { status: 404 });

    if (request.method !== "GET" || request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket upgrade required", { status: 426 });
    }

    const origin = request.headers.get("Origin");
    if (!origin || !ALLOWED_ORIGINS.has(origin)) {
      return new Response("Origin not allowed", { status: 403 });
    }

    const roomId = match[1];
    if (!ROOM_ID_RE.test(roomId)) return new Response("Invalid room", { status: 400 });

    const id = env.ROOMS.idFromName(roomId);
    return env.ROOMS.get(id).fetch(request);
  }
};

export class Room {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket upgrade required", { status: 426 });
    }

    const existing = this.ctx.getWebSockets();
    if (existing.length >= 2) {
      return new Response("Room is full", { status: 409 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const role = existing.length === 0 ? "initiator" : "responder";

    // Use the Durable Objects hibernation API, not server.accept().
    this.ctx.acceptWebSocket(server, [role]);

    server.send(JSON.stringify({
      type: "joined",
      role,
      peerCount: existing.length + 1
    }));

    if (existing.length === 1) {
      try {
        existing[0].send(JSON.stringify({ type: "peer-joined" }));
      } catch {
        // The other socket may have closed between enumeration and send.
      }
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(sender, message) {
    const peers = this.ctx.getWebSockets().filter(socket => socket !== sender);
    if (peers.length === 0) return;

    if (typeof message === "string") {
      if (message.length > MAX_SIGNAL_BYTES) {
        sender.close(1009, "Message too large");
        return;
      }

      let parsed;
      try {
        parsed = JSON.parse(message);
      } catch {
        sender.close(1008, "Invalid JSON");
        return;
      }

      if (!parsed || !["signal", "mode"].includes(parsed.type)) {
        sender.close(1008, "Unsupported message");
        return;
      }

      if (parsed.type === "signal") {
        if (!parsed.payload || typeof parsed.payload !== "object") {
          sender.close(1008, "Invalid signaling payload");
          return;
        }
        this.sendToPeers(peers, JSON.stringify({
          type: "signal",
          payload: parsed.payload
        }));
        return;
      }

      if (parsed.type === "mode" && parsed.mode === "tcp") {
        this.sendToPeers(peers, JSON.stringify({ type: "mode", mode: "tcp" }));
        return;
      }

      sender.close(1008, "Invalid mode");
      return;
    }

    // TCP fallback audio frames are end-to-end encrypted in the browser.
    if (message instanceof ArrayBuffer) {
      if (message.byteLength > MAX_AUDIO_FRAME_BYTES) {
        sender.close(1009, "Audio frame too large");
        return;
      }
      this.sendToPeers(peers, message);
      return;
    }

    sender.close(1003, "Unsupported frame type");
  }

  webSocketClose(sender, code, reason, wasClean) {
    const peers = this.ctx.getWebSockets().filter(socket => socket !== sender);
    this.sendToPeers(peers, JSON.stringify({ type: "peer-left" }));
  }

  webSocketError(sender, error) {
    const peers = this.ctx.getWebSockets().filter(socket => socket !== sender);
    this.sendToPeers(peers, JSON.stringify({ type: "peer-left" }));
  }

  sendToPeers(peers, message) {
    for (const peer of peers) {
      try {
        peer.send(message);
      } catch {
        // Ignore sockets that closed while the message was being forwarded.
      }
    }
  }
}
