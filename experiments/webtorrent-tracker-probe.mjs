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

    // Original proposal: one sequentially-derived info_hash (room) per 1 KiB packet.
    // Pre-join the receiver to all test rooms, then send at 25 packets/second.
    const roomPacketCount = 75;
    const roomPacketIntervalMs = 40;
    const roomPackets = [];
    for (let i = 0; i < roomPacketCount; i++) {
      const hash = roomHash(1000 + i);
      const ack = waitForMessage(
        receiver,
        (m) => m.action === "announce" && m.info_hash === hash,
        "receiver prejoin for packet-room " + i
      );
      send(receiver, {
        action: "announce", info_hash: hash, peer_id: receiverId,
        uploaded: 0, downloaded: 0, left: 1, event: "started", numwant: 0
      });
      await ack;
      roomPackets.push({ hash, hashHex: Buffer.from(hash, "latin1").toString("hex") });
    }

    const roomSentAt = new Map();
    const roomReceivedAt = new Map();
    const roomPayload = Buffer.alloc(PAYLOAD_BYTES, 0x3c);
    const roomListener = (raw) => {
      let message;
      try { message = JSON.parse(raw.toString()); } catch { return; }
      if (message.action !== "announce" || !message.offer?.sdp) return;
      const room = roomPackets.find((entry) => entry.hash === message.info_hash);
      if (!room) return;
      const markerLine = message.offer.sdp.split("\\r\\n").find((line) => line.startsWith("a=x-voicelink-room-packet:"));
      if (!markerLine) return;
      const markerParts = markerLine.slice("a=x-voicelink-room-packet:".length).split(":");
      if (markerParts.length !== 2) return;
      const packetNumber = Number(markerParts[0]);
      if (!roomSentAt.has(packetNumber) || roomReceivedAt.has(packetNumber)) return;
      const decoded = Buffer.from(markerParts[1], "base64");
      if (decoded.length !== PAYLOAD_BYTES || !decoded.equals(roomPayload)) return;
      roomReceivedAt.set(packetNumber, performance.now());
    };
    receiver.on("message", roomListener);

    const roomStreamStarted = performance.now();
    for (let i = 0; i < roomPacketCount; i++) {
      const room = roomPackets[i];
      const offerId = binaryString(createHash("sha256").update("room-packet-offer:" + i).digest().subarray(0, 20));
      const marker = "a=x-voicelink-room-packet:" + i + ":" + roomPayload.toString("base64");
      const sdp = ["v=0", "o=- 3 3 IN IP4 127.0.0.1", "s=VoiceLink sequential room probe", "t=0 0", marker, ""].join("\\r\\n");
      roomSentAt.set(i, performance.now());
      send(sender, {
        action: "announce", info_hash: room.hash, peer_id: senderId,
        uploaded: 0, downloaded: 0, left: 1, event: "started", numwant: 1,
        offers: [{ offer: { type: "offer", sdp }, offer_id: offerId }]
      });
      if (i + 1 < roomPacketCount) await new Promise((resolve) => setTimeout(resolve, roomPacketIntervalMs));
    }

    await new Promise((resolve) => setTimeout(resolve, 2500));
    receiver.off("message", roomListener);
    const roomLatencies = Array.from(roomReceivedAt, ([packet, received]) => received - roomSentAt.get(packet)).sort((a, b) => a - b);
    const roomPercentile = (p) => roomLatencies.length ? Math.round(roomLatencies[Math.min(roomLatencies.length - 1, Math.floor((roomLatencies.length - 1) * p))]) : null;
    const roomStreamResult = {
      payloadBytes: PAYLOAD_BYTES,
      targetRatePerSecond: 1000 / roomPacketIntervalMs,
      rooms: roomPacketCount,
      sentPackets: roomPacketCount,
      receivedPackets: roomReceivedAt.size,
      lostPackets: roomPacketCount - roomReceivedAt.size,
      lossPercent: Number(((roomPacketCount - roomReceivedAt.size) / roomPacketCount * 100).toFixed(2)),
      elapsedMs: Math.round(performance.now() - roomStreamStarted),
      latencyMs: { min: roomLatencies.length ? Math.round(roomLatencies[0]) : null, median: roomPercentile(0.5), p95: roomPercentile(0.95), max: roomLatencies.length ? Math.round(roomLatencies[roomLatencies.length - 1]) : null }
    };
    console.log("ROOM_STREAM " + JSON.stringify(roomStreamResult));

    // Sliding-window test: receiver keeps at most five rooms joined.
    // On receipt of packet i, it joins i+5, then leaves room i.
    const slidingPacketCount = 75;
    const slidingWindowSize = 5;
    const slidingIntervalMs = 40;
    const slidingBase = 5000;
    const slidingRooms = Array.from({ length: slidingPacketCount }, (_, i) => {
      const hash = roomHash(slidingBase + i);
      return { index: i, hash, hashHex: Buffer.from(hash, "latin1").toString("hex") };
    });
    const slidingPayload = Buffer.alloc(PAYLOAD_BYTES, 0x6d);
    const slidingSentAt = new Map();
    const slidingReceivedAt = new Map();
    const joinedRooms = new Set();
    const joinTimes = [];
    const leaveTimes = [];
    let nextRoomToJoin = slidingWindowSize;
    let slidingFailure = null;
    let slidingWork = Promise.resolve();

    async function joinSlidingRoom(index) {
      const room = slidingRooms[index];
      if (!room || joinedRooms.has(index)) return;
      const started = performance.now();
      const ack = waitForMessage(
        receiver,
        (m) => m.action === "announce" && m.info_hash === room.hash,
        "sliding join room " + index
      );
      send(receiver, {
        action: "announce", info_hash: room.hash, peer_id: receiverId,
        uploaded: 0, downloaded: 0, left: 1, event: "started", numwant: 0
      });
      await ack;
      joinedRooms.add(index);
      joinTimes.push(performance.now() - started);
    }

    async function leaveSlidingRoom(index) {
      const room = slidingRooms[index];
      if (!room || !joinedRooms.has(index)) return;
      // The public tracker processes "stopped" but does not send an announce
      // acknowledgement for it. Send it fire-and-forget; do not block the window.
      send(receiver, {
        action: "announce", info_hash: room.hash, peer_id: receiverId,
        uploaded: 0, downloaded: 0, left: 1, event: "stopped", numwant: 0
      });
      joinedRooms.delete(index);
      leaveTimes.push(0);
    }

    const slidingListener = (raw) => {
      let message;
      try { message = JSON.parse(raw.toString()); } catch { return; }
      if (message.action !== "announce" || !message.offer?.sdp) return;
      const room = slidingRooms.find((entry) => entry.hash === message.info_hash);
      if (!room) return;
      const markerLine = message.offer.sdp.split("\\r\\n").find((line) => line.startsWith("a=x-voicelink-sliding:"));
      if (!markerLine) return;
      const markerParts = markerLine.slice("a=x-voicelink-sliding:".length).split(":");
      if (markerParts.length !== 2) return;
      const packetNumber = Number(markerParts[0]);
      if (packetNumber !== room.index || !slidingSentAt.has(packetNumber) || slidingReceivedAt.has(packetNumber)) return;
      const decoded = Buffer.from(markerParts[1], "base64");
      if (decoded.length !== PAYLOAD_BYTES || !decoded.equals(slidingPayload)) return;
      slidingReceivedAt.set(packetNumber, performance.now());

      // Serialize window maintenance so joins/leaves cannot race each other.
      slidingWork = slidingWork.then(async () => {
        const newIndex = nextRoomToJoin;
        if (newIndex < slidingPacketCount) {
          await joinSlidingRoom(newIndex);
          nextRoomToJoin++;
        }
        await leaveSlidingRoom(packetNumber);
      }).catch((error) => {
        slidingFailure = error.message;
        console.error("SLIDING WINDOW ERROR:", error.message);
      });
    };

    // Initial window: exactly five joined rooms.
    for (let i = 0; i < slidingWindowSize; i++) await joinSlidingRoom(i);
    receiver.on("message", slidingListener);

    const slidingStarted = performance.now();
    for (let i = 0; i < slidingPacketCount; i++) {
      const room = slidingRooms[i];
      const offerId = binaryString(createHash("sha256").update("sliding-offer:" + i).digest().subarray(0, 20));
      const marker = "a=x-voicelink-sliding:" + i + ":" + slidingPayload.toString("base64");
      const sdp = ["v=0", "o=- 4 4 IN IP4 127.0.0.1", "s=VoiceLink sliding-window probe", "t=0 0", marker, ""].join("\\r\\n");
      slidingSentAt.set(i, performance.now());
      send(sender, {
        action: "announce", info_hash: room.hash, peer_id: senderId,
        uploaded: 0, downloaded: 0, left: 1, event: "started", numwant: 1,
        offers: [{ offer: { type: "offer", sdp }, offer_id: offerId }]
      });
      if (i + 1 < slidingPacketCount) await new Promise((resolve) => setTimeout(resolve, slidingIntervalMs));
    }

    await new Promise((resolve) => setTimeout(resolve, 3000));
    await slidingWork;
    receiver.off("message", slidingListener);
    const slidingLatencies = Array.from(slidingReceivedAt, ([packet, received]) => received - slidingSentAt.get(packet)).sort((a, b) => a - b);
    const slidingPercentile = (p) => slidingLatencies.length ? Math.round(slidingLatencies[Math.min(slidingLatencies.length - 1, Math.floor((slidingLatencies.length - 1) * p))]) : null;
    const slidingResult = {
      payloadBytes: PAYLOAD_BYTES,
      targetRatePerSecond: 1000 / slidingIntervalMs,
      packetCount: slidingPacketCount,
      windowSize: slidingWindowSize,
      initialJoinedRooms: slidingWindowSize,
      maxJoinedRooms: slidingWindowSize,
      sentPackets: slidingPacketCount,
      receivedPackets: slidingReceivedAt.size,
      lostPackets: slidingPacketCount - slidingReceivedAt.size,
      lossPercent: Number(((slidingPacketCount - slidingReceivedAt.size) / slidingPacketCount * 100).toFixed(2)),
      elapsedMs: Math.round(performance.now() - slidingStarted),
      latencyMs: { min: slidingLatencies.length ? Math.round(slidingLatencies[0]) : null, median: slidingPercentile(0.5), p95: slidingPercentile(0.95), max: slidingLatencies.length ? Math.round(slidingLatencies[slidingLatencies.length - 1]) : null },
      averageJoinMs: joinTimes.length ? Math.round(joinTimes.reduce((a, b) => a + b, 0) / joinTimes.length) : null,
      stoppedAnnouncementsSent: leaveTimes.length,
      remainingJoinedRooms: joinedRooms.size,
      maintenanceError: slidingFailure
    };
    console.log("SLIDING_WINDOW " + JSON.stringify(slidingResult));

    console.log("\\nRESULT " + JSON.stringify({ tracker: url, rooms: results, stream: streamResult, sequentialRoomStream: roomStreamResult, slidingWindow: slidingResult, sameRunnerIp: true }));
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
