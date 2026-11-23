#!/usr/bin/env node
"use strict";

// Isolated integration test for private Supabase Broadcast notifications from public.messages.
// Creates temporary anonymous users, subscribes over WebSocket, redeems an
// invitation, verifies recipient delivery and RLS filtering, then cleans up.
// This script is explicit and is never part of "npm start".

const crypto = require("node:crypto");
const { Client } = require("pg");

const PROJECT_REF = "lcmccpecmtnqknthtijl";
const EXPECTED_ORIGIN = `https://${PROJECT_REF}.supabase.co`;
const JOIN_TIMEOUT_MS = 15000;
const DELIVERY_TIMEOUT_MS = 12000;
const UNAUTHORIZED_GRACE_MS = 2000;

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function readConfig() {
  const rawUrl = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  const dbUrl = process.env.SUPABASE_DB_URL;

  if (!rawUrl || !publishableKey || !dbUrl) {
    fail("SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and SUPABASE_DB_URL are required.");
  }

  let url;
  let db;
  try {
    url = new URL(rawUrl);
    db = new URL(dbUrl);
  } catch {
    fail("A Supabase URL environment variable is invalid.");
  }

  if (url.origin !== EXPECTED_ORIGIN) {
    fail("SUPABASE_URL does not point to the expected VoiceLink project.");
  }
  if (!["postgres:", "postgresql:"].includes(db.protocol) ||
      !db.hostname.endsWith(".pooler.supabase.com") ||
      decodeURIComponent(db.username) !== "postgres." + PROJECT_REF ||
      db.port !== "5432") {
    fail("SUPABASE_DB_URL must be this project's Session pooler URI on port 5432.");
  }
  if (!publishableKey.startsWith("sb_publishable_")) {
    fail("SUPABASE_PUBLISHABLE_KEY must be this project's publishable key.");
  }

  return { url: url.origin, publishableKey, dbUrl };
}

async function readResponse(response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

async function apiRequest(url, key, accessToken, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      apikey: key,
      ...(accessToken ? { Authorization: "Bearer " + accessToken } : {}),
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    },
    signal: AbortSignal.timeout(15000)
  });
  const data = await readResponse(response);
  return { response, data };
}

async function createAnonymousUser(baseUrl, publishableKey) {
  const { response, data } = await apiRequest(
    baseUrl + "/auth/v1/signup",
    publishableKey,
    null,
    { method: "POST", body: JSON.stringify({ data: {} }) }
  );

  if (!response.ok) {
    const detail = data && typeof data === "object"
      ? (data.msg || data.message || data.error_description || data.error || "Auth request rejected")
      : "Auth request rejected";
    fail(`Anonymous Auth failed (HTTP ${response.status}): ${String(detail).slice(0, 180)}`);
  }

  const user = data && (data.user || data);
  const session = data && data.access_token
    ? data
    : data && data.session;
  assert(user && user.id, "Anonymous Auth response did not contain a user.");
  assert(session && session.access_token, "Anonymous Auth did not return a session; check anonymous sign-in settings.");

  return { id: user.id, accessToken: session.access_token };
}

async function rpc(baseUrl, key, user, name, args) {
  const { response, data } = await apiRequest(
    baseUrl + "/rest/v1/rpc/" + name,
    key,
    user.accessToken,
    { method: "POST", body: JSON.stringify(args) }
  );
  if (!response.ok) {
    const detail = data && typeof data === "object"
      ? (data.message || data.msg || data.code || "RPC rejected")
      : "RPC rejected";
    fail(`${name} failed (HTTP ${response.status}): ${String(detail).slice(0, 180)}`);
  }
  return data;
}


function openRealtimeSubscriber(baseUrl, publishableKey, user, label, topicUserId = user.id) {
  if (typeof WebSocket !== "function") {
    fail("This Node.js runtime does not provide the built-in WebSocket API.");
  }

  const wsUrl = new URL("/realtime/v1/websocket", baseUrl);
  wsUrl.protocol = "wss:";
  wsUrl.searchParams.set("apikey", publishableKey);
  wsUrl.searchParams.set("vsn", "1.0.0");

  // Each authenticated user listens only on their own private inbox topic.
  const topic = "realtime:inbox:" + topicUserId;
  const joinRef = "1";
  const ws = new WebSocket(wsUrl);
  const received = [];
  let joinAccepted = false;
  let heartbeatRef = 1;
  let heartbeatTimer = null;
  let resolveReady;
  let rejectReady;

  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const readyTimeout = setTimeout(() => {
    rejectReady(new Error(`Realtime subscription timed out for ${label}.`));
  }, JOIN_TIMEOUT_MS);

  function maybeReady() {
    if (joinAccepted) {
      clearTimeout(readyTimeout);
      resolveReady();
    }
  }

  ws.addEventListener("open", () => {
    ws.send(JSON.stringify({
      topic,
      event: "phx_join",
      payload: {
        config: {
          broadcast: { ack: false, self: false },
          presence: { enabled: false },
          private: true
        },
        access_token: user.accessToken
      },
      ref: joinRef,
      join_ref: joinRef
    }));

    heartbeatTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        heartbeatRef += 1;
        ws.send(JSON.stringify({
          topic: "phoenix",
          event: "heartbeat",
          payload: {},
          ref: String(heartbeatRef),
          join_ref: null
        }));
      }
    }, 20000);
  });

  ws.addEventListener("message", event => {
    let message;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }

    if (message.event === "phx_reply" && message.ref === joinRef) {
      if (!message.payload || message.payload.status !== "ok") {
        const response = message.payload && message.payload.response;
        const reason = response && (response.reason || response.message || response.code)
          ? (response.reason || response.message || response.code)
          : (message.payload && (message.payload.reason || message.payload.message || message.payload.status))
            || "no reason supplied";
        const safeReason = String(reason).replace(/[\\r\\n]/g, " ").slice(0, 300);
        rejectReady(new Error(`Realtime channel join failed for ${label}: ${safeReason}`));
        return;
      }
      joinAccepted = true;
      maybeReady();
      return;
    }

    if (message.event === "broadcast" && message.payload) {
      received.push(message.payload);
    }

    if (message.event === "phx_error" || message.event === "phx_close") {
      rejectReady(new Error(`Realtime channel closed or errored for ${label}.`));
    }
  });

  ws.addEventListener("error", () => {
    rejectReady(new Error(`Realtime WebSocket connection failed for ${label}.`));
  });
  ws.addEventListener("close", () => {
    clearInterval(heartbeatTimer);
    if (ws.readyState !== WebSocket.CLOSED) {
      rejectReady(new Error(`Realtime WebSocket closed unexpectedly for ${label}.`));
    }
  });

  return {
    label,
    received,
    ready,
    close() {
      clearTimeout(readyTimeout);
      clearInterval(heartbeatTimer);
      try { if (ws.readyState === WebSocket.OPEN) ws.close(1000, "test complete"); } catch {}
    }
  };
}

async function waitForEvent(subscriber, predicate, timeoutMs) {
  const existing = subscriber.received.find(predicate);
  if (existing) return existing;

  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const poll = setInterval(() => {
      const found = subscriber.received.find(predicate);
      if (found) {
        clearInterval(poll);
        resolve(found);
      } else if (Date.now() >= deadline) {
        clearInterval(poll);
        reject(new Error(`No matching private Broadcast event arrived for ${subscriber.label} within ${timeoutMs} ms.`));
      }
    }, 50);
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const config = readConfig();
  const db = new Client({
    connectionString: config.dbUrl,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000
  });

  const createdUserIds = [];
  const subscribers = [];
  let connected = false;

  try {
    await db.connect();
    connected = true;

    const identity = await db.query(
      "select current_database() as db, current_setting('server_version') as version"
    );
    console.log("Connected to VoiceLink Supabase:", identity.rows[0].db, "| PostgreSQL", identity.rows[0].version);

    const recipient = await createAnonymousUser(config.url, config.publishableKey);
    createdUserIds.push(recipient.id);
    const sender = await createAnonymousUser(config.url, config.publishableKey);
    createdUserIds.push(sender.id);
    const unrelated = await createAnonymousUser(config.url, config.publishableKey);
    createdUserIds.push(unrelated.id);
    console.log("Created three temporary anonymous Auth users.");

    const invitationId = crypto.randomBytes(32).toString("base64url");
    await rpc(config.url, config.publishableKey, recipient, "create_invitation", {
      p_invitation_id: invitationId
    });

    const recipientSub = openRealtimeSubscriber(config.url, config.publishableKey, recipient, "recipient");
    const senderSub = openRealtimeSubscriber(config.url, config.publishableKey, sender, "sender", recipient.id);
    const unrelatedSub = openRealtimeSubscriber(config.url, config.publishableKey, unrelated, "unrelated user", recipient.id);
    subscribers.push(recipientSub, senderSub, unrelatedSub);

    await recipientSub.ready;
    const unauthorizedJoins = await Promise.allSettled([senderSub.ready, unrelatedSub.ready]);
    assert(unauthorizedJoins.every(result => result.status === "rejected"),
      "Private Broadcast authorization allowed a non-recipient to join another user's inbox topic.");
    console.log("PASS: recipient joined the private inbox topic; sender and unrelated user were denied.");

    const nonce = crypto.randomUUID();
    const createdAt = await rpc(config.url, config.publishableKey, sender, "submit_message", {
      p_payload: { type: "integration_test_realtime", nonce },
      p_recipient_id: null,
      p_invitation_id: invitationId
    });
    assert(typeof createdAt === "string" && !Number.isNaN(Date.parse(createdAt)),
      "submit_message did not return the created_at timestamp.");

    const event = await waitForEvent(
      recipientSub,
      item => item.event === "INSERT" && item.payload && item.payload.record &&
        item.payload.record.payload && item.payload.record.payload.nonce === nonce,
      DELIVERY_TIMEOUT_MS
    );

    const broadcast = event;
    const record = broadcast.payload.record;
    assert(broadcast.event === "INSERT" && record,
      "Broadcast event does not contain the inserted inbox record.");
    assert(record.recipient_id === recipient.id && record.sender_id === sender.id,
      "Broadcast event was routed to the wrong sender or recipient.");
    assert(BigInt(record.recipient_seq) === 1n,
      "First private Broadcast row did not include recipient_seq=1.");
    assert(record.payload && record.payload.nonce === nonce,
      "Broadcast event payload does not match the inserted message.");
    assert(record.created_at && !Number.isNaN(Date.parse(record.created_at)) &&
      Date.parse(record.created_at) === Date.parse(createdAt),
      "Broadcast event did not include the returned created_at timestamp.");
    console.log("PASS: database trigger broadcast the complete inserted row to the recipient's private topic.");

    await sleep(UNAUTHORIZED_GRACE_MS);
    assert(!senderSub.received.length && !unrelatedSub.received.length,
      "A non-recipient received a private inbox Broadcast event.");
    console.log("PASS: no Broadcast event leaked to non-recipients.");


    console.log("ALL SUPABASE PRIVATE BROADCAST CHECKS PASSED.");
  } finally {
    for (const subscriber of subscribers) subscriber.close();

    if (connected) {
      try {
        if (createdUserIds.length) {
          const cleanup = await db.query(
            "delete from auth.users where id = any($1::uuid[])",
            [createdUserIds]
          );
          console.log("Cleanup: deleted", cleanup.rowCount, "temporary Auth users and their test data.");
        }
      } catch (error) {
        console.error("WARNING: temporary test users could not be cleaned up automatically. Check auth.users for the test run.");
        throw error;
      } finally {
        await db.end();
      }
    }
  }
}

main().catch(error => {
  console.error("Supabase private Broadcast test failed:", error.message);
  process.exitCode = 1;
});
