import WebSocket from "ws";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { fork } from "node:child_process";

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

    // Sliding-window tests at 25 packets/second. Room joins are concurrent:
    // packet i triggers pre-joining room i+windowSize; once joined, room i is stopped.
    async function runSlidingWindow(windowSize, slidingBase) {
      const slidingPacketCount = 75;
      const slidingIntervalMs = 40;
      const slidingRooms = Array.from({ length: slidingPacketCount }, (_, i) => {
        const hash = roomHash(slidingBase + i);
        return { index: i, hash, hashHex: Buffer.from(hash, "latin1").toString("hex") };
      });
      const slidingPayload = Buffer.alloc(PAYLOAD_BYTES, 0x6d);
      const slidingSentAt = new Map();
      const slidingElapsedUs = new Map();
      const slidingReceivedAt = new Map();
      const joinedRooms = new Set();
      const joiningRooms = new Map();
      const joinTimes = [];
      let maxConcurrentJoins = 0;
      let maxJoinedRooms = 0;
      let maintenanceFailure = null;
      const pendingMaintenance = new Set();

      async function joinSlidingRoom(index) {
        const room = slidingRooms[index];
        if (!room || joinedRooms.has(index)) return;
        if (joiningRooms.has(index)) return joiningRooms.get(index);
        const started = performance.now();
        const task = (async () => {
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
          maxJoinedRooms = Math.max(maxJoinedRooms, joinedRooms.size);
          joinTimes.push(performance.now() - started);
        })();
        joiningRooms.set(index, task);
        maxConcurrentJoins = Math.max(maxConcurrentJoins, joiningRooms.size);
        try { await task; } finally { joiningRooms.delete(index); }
      }

      function leaveSlidingRoom(index) {
        const room = slidingRooms[index];
        if (!room || !joinedRooms.has(index)) return;
        send(receiver, {
          action: "announce", info_hash: room.hash, peer_id: receiverId,
          uploaded: 0, downloaded: 0, left: 1, event: "stopped", numwant: 0
        });
        joinedRooms.delete(index);
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
        if (markerParts.length !== 3) return;
        const packetNumber = Number(markerParts[0]);
        const elapsedUs = Number(markerParts[1]);
        if (packetNumber !== room.index || !Number.isFinite(elapsedUs) || !slidingSentAt.has(packetNumber) || slidingReceivedAt.has(packetNumber)) return;
        const decoded = Buffer.from(markerParts[2], "base64");
        if (decoded.length !== PAYLOAD_BYTES || !decoded.equals(slidingPayload)) return;
        slidingReceivedAt.set(packetNumber, performance.now());

        const nextIndex = packetNumber + windowSize;
        if (nextIndex < slidingPacketCount) {
          const maintenance = joinSlidingRoom(nextIndex)
            .then(() => leaveSlidingRoom(packetNumber))
            .catch((error) => {
              maintenanceFailure = error.message;
              console.error("SLIDING WINDOW ERROR:", error.message);
            });
          pendingMaintenance.add(maintenance);
          maintenance.finally(() => pendingMaintenance.delete(maintenance));
        } else {
          leaveSlidingRoom(packetNumber);
        }
      };

      for (let i = 0; i < windowSize; i++) await joinSlidingRoom(i);
      receiver.on("message", slidingListener);
      const slidingStarted = performance.now();
      const senderClockOrigin = slidingStarted;
      for (let i = 0; i < slidingPacketCount; i++) {
        const room = slidingRooms[i];
        const offerId = binaryString(createHash("sha256").update("sliding-offer:" + windowSize + ":" + i).digest().subarray(0, 20));
        const sentAt = performance.now();
        const elapsedUs = i === 0 ? 0 : Math.round((sentAt - senderClockOrigin) * 1000);
        const marker = "a=x-voicelink-sliding:" + i + ":" + elapsedUs + ":" + slidingPayload.toString("base64");
        const sdp = ["v=0", "o=- 4 4 IN IP4 127.0.0.1", "s=VoiceLink sliding-window probe", "t=0 0", marker, ""].join("\\r\\n");
        slidingSentAt.set(i, sentAt);
        slidingElapsedUs.set(i, elapsedUs);
        send(sender, {
          action: "announce", info_hash: room.hash, peer_id: senderId,
          uploaded: 0, downloaded: 0, left: 1, event: "started", numwant: 1,
          offers: [{ offer: { type: "offer", sdp }, offer_id: offerId }]
        });
        if (i + 1 < slidingPacketCount) await new Promise((resolve) => setTimeout(resolve, slidingIntervalMs));
      }
      await new Promise((resolve) => setTimeout(resolve, 2500));
      await Promise.allSettled(Array.from(pendingMaintenance));
      receiver.off("message", slidingListener);
      for (const index of Array.from(joinedRooms)) leaveSlidingRoom(index);
      const latencies = Array.from(slidingReceivedAt, ([packet, received]) => received - slidingSentAt.get(packet)).sort((a, b) => a - b);
      const percentile = (values, p) => values.length ? Math.round(values[Math.min(values.length - 1, Math.floor((values.length - 1) * p))]) : null;
      const timelineDeltas = [];
      const receiveGaps = [];
      const senderGaps = [];
      const sortedReceivedPackets = Array.from(slidingReceivedAt.keys()).sort((a, b) => a - b);
      const receiveIntervals = [];
      let sequenceHolesBetweenReceived = 0;
      for (let i = 1; i < sortedReceivedPackets.length; i++) {
        const prev = sortedReceivedPackets[i - 1], curr = sortedReceivedPackets[i];
        const sequenceDistance = curr - prev;
        const sourceDeltaMs = (slidingElapsedUs.get(curr) - slidingElapsedUs.get(prev)) / 1000;
        const receiveDeltaMs = slidingReceivedAt.get(curr) - slidingReceivedAt.get(prev);
        const expectedSourceWindowMs = slidingIntervalMs * sequenceDistance;
        timelineDeltas.push(Math.abs(receiveDeltaMs - sourceDeltaMs));
        sequenceHolesBetweenReceived += Math.max(0, sequenceDistance - 1);
        receiveIntervals.push(receiveDeltaMs);
        if (sourceDeltaMs > expectedSourceWindowMs * 1.5) senderGaps.push(sourceDeltaMs);
        if (receiveDeltaMs > expectedSourceWindowMs * 1.5 && sourceDeltaMs <= expectedSourceWindowMs * 1.5) receiveGaps.push(receiveDeltaMs);
      }
      receiveIntervals.sort((a, b) => a - b);
      const result = {
        payloadBytes: PAYLOAD_BYTES,
        targetRatePerSecond: 1000 / slidingIntervalMs,
        packetCount: slidingPacketCount,
        windowSize,
        sentPackets: slidingPacketCount,
        receivedPackets: slidingReceivedAt.size,
        lostPackets: slidingPacketCount - slidingReceivedAt.size,
        lossPercent: Number(((slidingPacketCount - slidingReceivedAt.size) / slidingPacketCount * 100).toFixed(2)),
        elapsedMs: Math.round(performance.now() - slidingStarted),
        latencyMs: { min: latencies.length ? Math.round(latencies[0]) : null, median: percentile(latencies, 0.5), p95: percentile(latencies, 0.95), max: latencies.length ? Math.round(latencies[latencies.length - 1]) : null },
        senderTimeline: "monotonic elapsed microseconds since packet 0",
        timingMetadataFormat: "decimal elapsed microseconds since packet 0, carried in custom SDP attribute",
        interPacketTiming: {
          comparedIntervals: timelineDeltas.length,
          medianAbsoluteDeltaErrorMs: percentile(timelineDeltas, 0.5),
          p95AbsoluteDeltaErrorMs: percentile(timelineDeltas, 0.95),
          maxConsecutiveReceiveGapMs: receiveIntervals.length ? Math.round(receiveIntervals[receiveIntervals.length - 1]) : null,
          detectedSenderGaps: senderGaps.length,
          detectedReceiveGaps: receiveGaps.length,
          sequenceHolesBetweenReceived
        },
        averageJoinMs: joinTimes.length ? Math.round(joinTimes.reduce((a, b) => a + b, 0) / joinTimes.length) : null,
        maxConcurrentJoins,
        maxJoinedRooms,
        remainingJoinedRooms: joinedRooms.size,
        maintenanceError: maintenanceFailure
      };
      console.log("SLIDING_WINDOW " + JSON.stringify(result));
      return result;
    }

    const slidingResults = [];
    slidingResults.push(await runSlidingWindow(10, 7000));
    slidingResults.push(await runSlidingWindow(12, 8000));
    const slidingWindowResult = slidingResults;

    // Deterministic slot-timeline model: room number is derived from elapsed time,
    // not from the count of packets actually sent. No per-packet timestamp is required.
    function runSlotTimelineModel() {
      const slotMs = 40;
      const windowSize = 12;
      const slotAt = (elapsedMs) => Math.floor(elapsedMs / slotMs);
      const windowAt = (elapsedMs) => {
        const first = slotAt(elapsedMs);
        return Array.from({ length: windowSize }, (_, offset) => first + offset);
      };
      const assert = (condition, message) => {
        if (!condition) throw new Error("SLOT_TIMELINE_ASSERT: " + message);
      };

      // Normal cadence: each 40 ms interval maps to exactly one room/slot.
      const normal = Array.from({ length: 10 }, (_, i) => slotAt(i * slotMs));
      assert(normal.every((slot, i) => slot === i), "normal cadence must map 1:1 to slots");

      // Sender pauses for 320 ms after slot 20. The next packet's room is selected
      // from elapsed time, so stale slots are skipped instead of being replayed.
      const beforePauseMs = 20 * slotMs;
      const afterPauseMs = beforePauseMs + 320 + slotMs;
      const beforePauseSlot = slotAt(beforePauseMs);
      const afterPauseSlot = slotAt(afterPauseMs);
      assert(afterPauseSlot - beforePauseSlot === 9, "sender pause must advance timeline by elapsed time");
      const afterPauseWindow = windowAt(afterPauseMs);
      assert(afterPauseWindow[0] === afterPauseSlot, "window must start at current slot after sender pause");
      assert(!afterPauseWindow.includes(beforePauseSlot + 1), "obsolete slots must not remain in active window");

      // Receiver falls 500 ms behind processing/current time. It recalculates from
      // its own monotonic clock and jumps its target window forward immediately.
      const lastReceivedSlot = 30;
      const receiverNowMs = (lastReceivedSlot * slotMs) + 500;
      const receiverCurrentSlot = slotAt(receiverNowMs);
      const receiverWindow = windowAt(receiverNowMs);
      assert(receiverCurrentSlot === 42, "receiver must jump to slot 42 after 500 ms lag");
      assert(receiverWindow[0] === 42 && receiverWindow[11] === 53, "receiver window must follow current time");

      // A skipped packet does not shift the timebase: its missing slot is simply
      // absent, while the following packet retains the slot dictated by time.
      const sentSlots = [0, 1, 2, 4, 5];
      assert(sentSlots[3] === slotAt(4 * slotMs), "missing slot must not renumber later packets");

      const result = {
        slotDurationMs: slotMs,
        ratePerSecond: 1000 / slotMs,
        windowSize,
        normalCadence: { sentSlots: normal, passed: true },
        senderPause: {
          pauseMs: 320,
          previousSlot: beforePauseSlot,
          nextSlot: afterPauseSlot,
          skippedSlots: afterPauseSlot - beforePauseSlot - 1,
          activeWindowStart: afterPauseWindow[0],
          passed: true
        },
        receiverLag: {
          lastReceivedSlot,
          receiverElapsedMs: receiverNowMs,
          receiverCurrentSlot,
          activeWindow: [receiverWindow[0], receiverWindow[receiverWindow.length - 1]],
          passed: true
        },
        packetLoss: { sentSlots, missingSlot: 3, subsequentSlotUnchanged: true, passed: true },
        perPacketTimestampRequired: false
      };
      console.log("SLOT_TIMELINE_MODEL " + JSON.stringify(result));
      return result;
    }
    const slotTimelineModel = runSlotTimelineModel();

    // Real tracker-room test using time-derived slot numbers. The receiver moves
    // its subscription window from its local monotonic clock, including during
    // sender silence; there is no elapsed-time field in the packet payload.
    async function runLiveSlotWindow() {
      const slotMs = 40;
      const windowSize = 12;
      const packetCount = 32;
      const pauseAfterPacket = 12;
      const senderPauseMs = 320;
      const maxSlot = 100;
      const rooms = Array.from({ length: maxSlot + 1 }, (_, slot) => ({
        slot,
        hash: roomHash(30000 + slot)
      }));
      const joined = new Set();
      const joining = new Map();
      const received = new Map();
      const sent = new Map();
      const joinDurations = [];
      let joinErrors = [];
      let maxConcurrent = 0;
      let maxJoined = 0;
      let epoch = 0;
      let timer = null;

      async function joinSlot(slot) {
        if (slot < 0 || slot > maxSlot || joined.has(slot)) return;
        if (joining.has(slot)) return joining.get(slot);
        const room = rooms[slot];
        const started = performance.now();
        const task = (async () => {
          const ack = waitForMessage(receiver,
            (m) => m.action === "announce" && m.info_hash === room.hash,
            "live slot join " + slot);
          send(receiver, {
            action: "announce", info_hash: room.hash, peer_id: receiverId,
            uploaded: 0, downloaded: 0, left: 1, event: "started", numwant: 0
          });
          await ack;
          joined.add(slot);
          joinDurations.push(performance.now() - started);
          maxJoined = Math.max(maxJoined, joined.size);
        })();
        joining.set(slot, task);
        maxConcurrent = Math.max(maxConcurrent, joining.size);
        try { await task; } finally { joining.delete(slot); }
      }

      function leaveBefore(currentSlot) {
        for (const slot of Array.from(joined)) {
          if (slot < currentSlot) {
            send(receiver, {
              action: "announce", info_hash: rooms[slot].hash, peer_id: receiverId,
              uploaded: 0, downloaded: 0, left: 1, event: "stopped", numwant: 0
            });
            joined.delete(slot);
          }
        }
      }

      const listener = (raw) => {
        let m;
        try { m = JSON.parse(raw.toString()); } catch { return; }
        if (m.action !== "announce" || !m.offer?.sdp) return;
        const room = rooms.find((entry) => entry.hash === m.info_hash);
        if (!room) return;
        const line = m.offer.sdp.split("\\r\\n").find((x) => x.startsWith("a=x-voicelink-slot:"));
        if (!line) return;
        const parts = line.slice("a=x-voicelink-slot:".length).split(":");
        if (parts.length !== 2) return;
        const slot = Number(parts[0]);
        if (slot !== room.slot || received.has(slot)) return;
        const bytes = Buffer.from(parts[1], "base64");
        if (bytes.length !== PAYLOAD_BYTES) return;
        received.set(slot, performance.now());
      };

      try {
        for (let slot = 0; slot < windowSize; slot++) await joinSlot(slot);
        receiver.on("message", listener);
        epoch = performance.now();

        // Timer-based window reconciliation is essential: it advances even
        // when no packets arrive from the sender.
        timer = setInterval(() => {
          const currentSlot = Math.floor((performance.now() - epoch) / slotMs);
          const targetSlot = currentSlot + windowSize - 1;
          if (targetSlot <= maxSlot && !joined.has(targetSlot) && !joining.has(targetSlot)) {
            joinSlot(targetSlot).catch((error) => {
              joinErrors.push({ slot: targetSlot, error: error.message });
            });
          }
          leaveBefore(currentSlot);
        }, 20);

        const payload = Buffer.alloc(PAYLOAD_BYTES, 0x7b);
        const sendSlots = [];
        let lastSentSlot = -1;
        for (let i = 0; i < packetCount; i++) {
          if (i === pauseAfterPacket) {
            await new Promise((resolve) => setTimeout(resolve, senderPauseMs));
          }
          let slot = Math.floor((performance.now() - epoch) / slotMs);
          if (slot <= lastSentSlot) {
            const nextSlotBoundary = epoch + (lastSentSlot + 1) * slotMs + 3;
            const waitMs = nextSlotBoundary - performance.now();
            if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
            slot = Math.floor((performance.now() - epoch) / slotMs);
          }
          if (slot <= lastSentSlot) throw new Error("sender failed to advance to a new time slot");
          const room = rooms[slot];
          if (!room) throw new Error("live slot exceeded test room range: " + slot);
          const offerId = binaryString(createHash("sha256").update("live-slot-offer:" + i + ":" + slot).digest().subarray(0, 20));
          const marker = "a=x-voicelink-slot:" + slot + ":" + payload.toString("base64");
          const sdp = ["v=0", "o=- 5 5 IN IP4 127.0.0.1", "s=VoiceLink live slot probe", "t=0 0", marker, ""].join("\\r\\n");
          sent.set(slot, performance.now());
          sendSlots.push(slot);
          lastSentSlot = slot;
          send(sender, {
            action: "announce", info_hash: room.hash, peer_id: senderId,
            uploaded: 0, downloaded: 0, left: 1, event: "started", numwant: 1,
            offers: [{ offer: { type: "offer", sdp }, offer_id: offerId }]
          });
        }

        await new Promise((resolve) => setTimeout(resolve, 1800));
        const sortedSent = sendSlots.slice().sort((a, b) => a - b);
        const missingSlots = sortedSent.filter((slot) => !received.has(slot));
        const result = {
          payloadBytes: PAYLOAD_BYTES,
          slotDurationMs: slotMs,
          targetRatePerSecond: 1000 / slotMs,
          windowSize,
          plannedPackets: packetCount,
          sentPackets: sent.size,
          receivedPackets: received.size,
          missingSentSlots: missingSlots,
          senderPauseMs,
          sentSlotSequence: sendSlots,
          skippedSlotsDuringPause: sendSlots[pauseAfterPacket] - sendSlots[pauseAfterPacket - 1] - 1,
          averageRoomJoinMs: joinDurations.length ? Math.round(joinDurations.reduce((a,b)=>a+b,0)/joinDurations.length) : null,
          maxConcurrentJoins: maxConcurrent,
          maxJoinedRooms: maxJoined,
          remainingJoinedRooms: joined.size,
          joinErrors
        };
        console.log("LIVE_SLOT_WINDOW " + JSON.stringify(result));
        if (received.size !== sent.size || joinErrors.length) {
          throw new Error("live slot window did not receive all sent slots");
        }
        return result;
      } finally {
        if (timer) clearInterval(timer);
        receiver.off("message", listener);
        for (const slot of Array.from(joined)) {
          send(receiver, {
            action: "announce", info_hash: rooms[slot].hash, peer_id: receiverId,
            uploaded: 0, downloaded: 0, left: 1, event: "stopped", numwant: 0
          });
          joined.delete(slot);
        }
        await Promise.allSettled(Array.from(joining.values()));
      }
    }
    const liveSlotWindow = await runLiveSlotWindow();

    // Independent-process clock synchronization experiment. Each peer owns its
    // own monotonic origin and configurable clock-rate error. The parent only
    // simulates network transit delay and performs NTP-style four-timestamp sync.
    async function runIndependentClockSync() {
      const sender = fork(new URL("./clock-peer.mjs", import.meta.url), ["sender", "125000", "-80"], {
        stdio: ["ignore", "inherit", "inherit", "ipc"]
      });
      const receiver = fork(new URL("./clock-peer.mjs", import.meta.url), ["receiver", "-43000", "220"], {
        stdio: ["ignore", "inherit", "inherit", "ipc"]
      });
      let requestId = 0;
      function clockNow(child) {
        const id = ++requestId;
        return new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            child.off("message", onMessage);
            reject(new Error("clock peer request timeout"));
          }, 3000);
          function onMessage(message) {
            if (message?.type !== "clock-now-result" || message.id !== id) return;
            clearTimeout(timeout);
            child.off("message", onMessage);
            resolve(message.now);
          }
          child.on("message", onMessage);
          child.send({ type: "clock-now", id });
        });
      }
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const samples = [];
      const started = performance.now();
      try {
        for (let round = 0; round < 9; round++) {
          const roundSamples = [];
          for (let attempt = 0; attempt < 5; attempt++) {
            const t1 = await clockNow(sender);
            const outboundMs = 14 + ((round * 3 + attempt) % 4) * 7;
            const returnMs = outboundMs; // symmetric variable transit delay isolates clock drift from path asymmetry.
            await sleep(outboundMs);
            const t2 = await clockNow(receiver);
            const t3 = await clockNow(receiver);
            await sleep(returnMs);
            const t4 = await clockNow(sender);
            const offset = ((t2 - t1) + (t3 - t4)) / 2;
            const rtt = Math.max(0, (t4 - t1) - (t3 - t2));
            const receiverMid = (t2 + t3) / 2;
            roundSamples.push({ offset, rtt, receiverMid, outboundMs, returnMs });
          }
          roundSamples.sort((a, b) => a.rtt - b.rtt);
          samples.push(roundSamples[0]);
          if (round < 8) await sleep(650);
        }

        // Linear fit: offset(receiverClock - senderClock) as a function of
        // receiver monotonic time. The inverse mapping estimates sender time.
        const meanX = samples.reduce((s, x) => s + x.receiverMid, 0) / samples.length;
        const meanY = samples.reduce((s, x) => s + x.offset, 0) / samples.length;
        const numerator = samples.reduce((s, x) => s + (x.receiverMid - meanX) * (x.offset - meanY), 0);
        const denominator = samples.reduce((s, x) => s + (x.receiverMid - meanX) ** 2, 0);
        const drift = denominator ? numerator / denominator : 0;
        const intercept = meanY - drift * meanX;
        const estimatedSenderTime = (receiverNow) => receiverNow - (intercept + drift * receiverNow);

        const validation = [];
        for (let i = 0; i < 5; i++) {
          await sleep(350);
          const [actualSender, receiverLocal] = await Promise.all([clockNow(sender), clockNow(receiver)]);
          const estimated = estimatedSenderTime(receiverLocal);
          validation.push({
            actualSenderMs: Number(actualSender.toFixed(2)),
            estimatedSenderMs: Number(estimated.toFixed(2)),
            errorMs: Number((estimated - actualSender).toFixed(2)),
            slotErrorAt40ms: Math.round((estimated - actualSender) / 40)
          });
        }
        const errors = validation.map((x) => Math.abs(x.errorMs)).sort((a, b) => a - b);
        const maxError = errors[errors.length - 1];
        const result = {
          independentProcesses: true,
          senderClock: { offsetMs: 125000, driftPpm: -80 },
          receiverClock: { offsetMs: -43000, driftPpm: 220 },
          syncRounds: samples.length,
          samples: samples.map((x) => ({
            estimatedReceiverMinusSenderOffsetMs: Number(x.offset.toFixed(2)),
            roundTripMs: Number(x.rtt.toFixed(2)),
            outboundDelayMs: x.outboundMs,
            returnDelayMs: x.returnMs
          })),
          estimatedRelativeDriftPpm: Number((drift * 1_000_000).toFixed(1)),
          expectedRelativeDriftPpm: 300,
          validationErrorsMs: validation.map((x) => x.errorMs),
          maxAbsoluteClockMappingErrorMs: Number(maxError.toFixed(2)),
          maxSlotErrorAt40ms: Math.max(...validation.map((x) => Math.abs(x.slotErrorAt40ms))),
          validation,
          elapsedMs: Math.round(performance.now() - started)
        };
        console.log("INDEPENDENT_CLOCK_SYNC " + JSON.stringify(result));
        return result;
      } finally {
        for (const child of [sender, receiver]) {
          if (child.connected) child.disconnect();
          child.kill();
        }
      }
    }
    const independentClockSync = await runIndependentClockSync();


    // Adverse clock-sync test: changing path asymmetry, changing receiver drift,
    // a control-channel outage, then resynchronization. This is a controlled
    // simulation of independent process clocks and network transit delays.
    async function runAdverseClockSync() {
      const sender = fork(new URL("./clock-peer.mjs", import.meta.url), ["sender-adverse", "125000", "-80"], {
        stdio: ["ignore", "inherit", "inherit", "ipc"]
      });
      const receiver = fork(new URL("./clock-peer.mjs", import.meta.url), ["receiver-adverse", "-43000", "220"], {
        stdio: ["ignore", "inherit", "inherit", "ipc"]
      });
      let requestId = 0;
      function rpc(child, type, extra = {}) {
        const id = ++requestId;
        return new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            child.off("message", onMessage);
            reject(new Error("adverse clock peer request timeout: " + type));
          }, 3000);
          function onMessage(message) {
            if (message?.id !== id) return;
            if (message.type !== type + "-result") return;
            clearTimeout(timeout);
            child.off("message", onMessage);
            resolve(message);
          }
          child.on("message", onMessage);
          child.send({ type, id, ...extra });
        });
      }
      const now = async (child) => (await rpc(child, "clock-now")).now;
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      async function exchange(outboundMs, returnMs) {
        const t1 = await now(sender);
        await sleep(outboundMs);
        const t2 = await now(receiver);
        const t3 = await now(receiver);
        await sleep(returnMs);
        const t4 = await now(sender);
        return {
          offset: ((t2 - t1) + (t3 - t4)) / 2,
          rtt: Math.max(0, (t4 - t1) - (t3 - t2)),
          receiverMid: (t2 + t3) / 2,
          outboundMs,
          returnMs
        };
      }
      function fit(samples) {
        const meanX = samples.reduce((s, x) => s + x.receiverMid, 0) / samples.length;
        const meanY = samples.reduce((s, x) => s + x.offset, 0) / samples.length;
        const numerator = samples.reduce((s, x) => s + (x.receiverMid - meanX) * (x.offset - meanY), 0);
        const denominator = samples.reduce((s, x) => s + (x.receiverMid - meanX) ** 2, 0);
        const drift = denominator ? numerator / denominator : 0;
        const intercept = meanY - drift * meanX;
        return {
          drift,
          intercept,
          map: (receiverNow) => receiverNow - (intercept + drift * receiverNow)
        };
      }
      async function collect(count, outboundFn, returnFn, pauseMs = 300) {
        const samples = [];
        for (let i = 0; i < count; i++) {
          const attempts = [];
          for (let j = 0; j < 4; j++) {
            attempts.push(await exchange(outboundFn(i, j), returnFn(i, j)));
          }
          attempts.sort((a, b) => a.rtt - b.rtt);
          samples.push(attempts[0]);
          if (i + 1 < count) await sleep(pauseMs);
        }
        return samples;
      }
      try {
        const baselineSamples = await collect(7, (i,j) => 10 + ((i+j)%3)*4, (i,j) => 10 + ((i+j)%3)*4, 250);
        const baseline = fit(baselineSamples);

        const forwardHeavy = await collect(4, () => 8, () => 28, 250);
        const forwardHeavyBias = forwardHeavy.map((x) => ({
          measuredOffsetMs: Number(x.offset.toFixed(2)),
          baselinePredictedOffsetMs: Number((x.receiverMid - baseline.map(x.receiverMid)).toFixed(2)),
          estimatedAsymmetryBiasMs: Number((x.offset - (x.receiverMid - baseline.map(x.receiverMid))).toFixed(2)),
          outboundMs: x.outboundMs, returnMs: x.returnMs
        }));

        const reverseHeavy = await collect(4, () => 30, () => 8, 250);
        const reverseHeavyBias = reverseHeavy.map((x) => ({
          measuredOffsetMs: Number(x.offset.toFixed(2)),
          baselinePredictedOffsetMs: Number((x.receiverMid - baseline.map(x.receiverMid)).toFixed(2)),
          estimatedAsymmetryBiasMs: Number((x.offset - (x.receiverMid - baseline.map(x.receiverMid))).toFixed(2)),
          outboundMs: x.outboundMs, returnMs: x.returnMs
        }));

        // Change the receiver oscillator while the control exchange is paused.
        await rpc(receiver, "set-drift", { driftPpm: 1000 });
        await sleep(2500);
        const [senderAfterPause, receiverAfterPause] = await Promise.all([now(sender), now(receiver)]);
        const staleEstimate = baseline.map(receiverAfterPause);
        const staleMappingErrorMs = staleEstimate - senderAfterPause;

        // Restore frequent symmetric control exchanges and estimate the new drift.
        const recoverySamples = await collect(9, (i,j) => 12 + ((i+j)%4)*5, (i,j) => 12 + ((i+j)%4)*5, 250);
        const recovered = fit(recoverySamples);
        const recoveryValidation = [];
        for (let i = 0; i < 5; i++) {
          await sleep(300);
          const [actualSender, receiverLocal] = await Promise.all([now(sender), now(receiver)]);
          const estimatedSender = recovered.map(receiverLocal);
          recoveryValidation.push({
            errorMs: Number((estimatedSender - actualSender).toFixed(2)),
            slotErrorAt40ms: Math.round((estimatedSender - actualSender) / 40)
          });
        }
        const maxRecoveryError = Math.max(...recoveryValidation.map((x) => Math.abs(x.errorMs)));
        const medianBias = (items) => {
          const values = items.map((x) => x.estimatedAsymmetryBiasMs).sort((a,b)=>a-b);
          return values[Math.floor(values.length/2)];
        };
        const result = {
          test: "asymmetric-delay-change-drift-change-control-outage-recovery",
          simulatedClocksAreSeparateProcesses: true,
          initialRelativeDriftPpm: 300,
          receiverDriftChangedToPpm: 1000,
          controlOutageMs: 2500,
          baselineEstimatedRelativeDriftPpm: Number((baseline.drift * 1_000_000).toFixed(1)),
          forwardHeavyPath: {
            outboundMs: 8, returnMs: 28,
            medianEstimatedOffsetBiasMs: medianBias(forwardHeavyBias),
            samples: forwardHeavyBias
          },
          reverseHeavyPath: {
            outboundMs: 30, returnMs: 8,
            medianEstimatedOffsetBiasMs: medianBias(reverseHeavyBias),
            samples: reverseHeavyBias
          },
          staleMappingErrorAfterOutageMs: Number(staleMappingErrorMs.toFixed(2)),
          recoveredEstimatedRelativeDriftPpm: Number((recovered.drift * 1_000_000).toFixed(1)),
          expectedPostChangeRelativeDriftPpm: 1080,
          recoveryValidationErrorsMs: recoveryValidation.map((x) => x.errorMs),
          maxAbsoluteRecoveryErrorMs: Number(maxRecoveryError.toFixed(2)),
          maxRecoverySlotErrorAt40ms: Math.max(...recoveryValidation.map((x) => Math.abs(x.slotErrorAt40ms))),
          recoveryPassed: maxRecoveryError < 5
        };
        console.log("ADVERSE_CLOCK_SYNC " + JSON.stringify(result));
        if (!Number.isFinite(staleMappingErrorMs) || !Number.isFinite(recovered.drift)) {
          throw new Error("adverse clock sync produced a non-finite result");
        }
        return result;
      } finally {
        for (const child of [sender, receiver]) {
          if (child.connected) child.disconnect();
          child.kill();
        }
      }
    }
    const adverseClockSync = await runAdverseClockSync();

    console.log("\\nRESULT " + JSON.stringify({ tracker: url, rooms: results, stream: streamResult, sequentialRoomStream: roomStreamResult, slidingWindows: slidingWindowResult, slotTimelineModel, liveSlotWindow, independentClockSync, adverseClockSync, sameRunnerIp: true }));
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
