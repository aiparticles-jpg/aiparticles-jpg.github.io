#!/usr/bin/env node
"use strict";

// Isolated integration test for Supabase Postgres Changes on public.messages.
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


function openRealtimeSubscriber(baseUrl, publishableKey, user, label) {
  if (typeof WebSocket !== "function") {
    fail("This Node.js runtime does not provide the built-in WebSocket API.");
  }

  const wsUrl = new URL("/realtime/v1/websocket", baseUrl);
  wsUrl.protocol = "wss:";
  wsUrl.searchParams.set("apikey", publishableKey);
  wsUrl.searchParams.set("vsn", "1.0.0");

  // Each authenticated user listens only on their own private inbox topic.
  const topic = "realtime:inbox:" + user.id;
  const joinRef = "1";
  const ws = new WebSocket(wsUrl);
  const received = [];
  let joinAccepted = false;
  let postgresReady = false;
  let subscriptionId = null;
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
    if (joinAccepted && postgresReady && subscriptionId !== null) {
      clearTimeout(readyTimeout);
      resolveReady();
    }
  }

  ws.addEventListener("open", () => {
    const change = {
      event: "INSERT",
      schema: "public",
      table: "messages",
      select: ["sender_id", "recipient_id", "payload", "created_at"]
    };
    change.filter = "recipient_id=eq." + user.id;

    ws.send(JSON.stringify({
      topic,
      event: "phx_join",
      payload: {
        config: {
          broadcast: { ack: false, self: false },
          presence: { enabled: false },
          postgres_changes: [change],
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
      const subscriptions = message.payload.response && message.payload.response.postgres_changes;
      if (!Array.isArray(subscriptions) || !subscriptions[0] || subscriptions[0].id === undefined) {
        rejectReady(new Error(`Realtime did not confirm the Postgres Changes subscription for ${label}.`));
        return;
      }
      subscriptionId = subscriptions[0].id;
      joinAccepted = true;
      maybeReady();
      return;
    }

    if (message.event === "system" && message.payload &&
        message.payload.extension === "postgres_changes") {
      if (message.payload.status !== "ok") {
        rejectReady(new Error(`Postgres Changes subscription rejected for ${label}: ${String(message.payload.message || "unknown error").slice(0, 160)}`));
        return;
      }
      postgresReady = true;
      maybeReady();
      return;
    }

    if (message.event === "postgres_changes" && message.payload && message.payload.data) {
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
    get subscriptionId() { return subscriptionId; },
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
        reject(new Error(`No matching Postgres Changes event arrived for ${subscriber.label} within ${timeoutMs} ms.`));
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
    const senderSub = openRealtimeSubscriber(config.url, config.publishableKey, sender, "sender");
    const unrelatedSub = openRealtimeSubscriber(config.url, config.publishableKey, unrelated, "unrelated user");
    subscribers.push(recipientSub, senderSub, unrelatedSub);

    await Promise.all(subscribers.map(subscriber => subscriber.ready));
    console.log("PASS: recipient, sender and unrelated user established authenticated Postgres Changes subscriptions.");

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
      item => item.data && item.data.record && item.data.record.payload &&
        item.data.record.payload.nonce === nonce,
      DELIVERY_TIMEOUT_MS
    );

    const record = event.data.record;
    assert(event.data.schema === "public" && event.data.table === "messages" && event.data.type === "INSERT",
      "Realtime event has an unexpected schema, table or event type.");
    assert(record.recipient_id === recipient.id && record.sender_id === sender.id,
      "Realtime event was routed to the wrong sender or recipient.");
    assert(record.payload && record.payload.nonce === nonce,
      "Realtime event payload does not match the inserted message.");
    assert(record.created_at && !Number.isNaN(Date.parse(record.created_at)) &&
      Date.parse(record.created_at) === Date.parse(createdAt),
      "Realtime INSERT event did not include the returned created_at timestamp.");
    assert(Array.isArray(event.ids) && event.ids.includes(recipientSub.subscriptionId),
      "Realtime event subscription ID does not match the recipient subscription.");
    console.log("PASS: Postgres Changes delivered the new messages INSERT to the recipient's filtered subscription.");

    // The notification itself carries the complete row. The normal delivery path
    // deliberately performs no follow-up SELECT; durable recovery is tested separately.
    console.log("PASS: Realtime INSERT contains the complete inbox row and payload; no per-message SELECT is needed.");

    await sleep(UNAUTHORIZED_GRACE_MS);
    const leakedToSender = senderSub.received.some(item =>
      item.data && item.data.record && item.data.record.payload && item.data.record.payload.nonce === nonce
    );
    const leakedToUnrelated = unrelatedSub.received.some(item =>
      item.data && item.data.record && item.data.record.payload && item.data.record.payload.nonce === nonce
    );
    assert(!leakedToSender && !leakedToUnrelated,
      "RLS check failed: message change was delivered to the sender or unrelated user.");
    console.log("PASS: Postgres Changes did not deliver the recipient's message to the sender or unrelated user.");

    console.log("ALL SUPABASE POSTGRES CHANGES CHECKS PASSED.");
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
  console.error("Supabase Postgres Changes test failed:", error.message);
  process.exitCode = 1;
});
