#!/usr/bin/env node
"use strict";

// Isolated integration test for the direct Supabase signaling schema.
// Creates three temporary anonymous users, tests invitation redemption,
// inbox RLS and RPC routing, then deletes those users (and their test rows).
// This script is explicitly invoked and is never part of "npm start".

const crypto = require("node:crypto");
const { Client } = require("pg");

const PROJECT_REF = "lcmccpecmtnqknthtijl";
const EXPECTED_ORIGIN = `https://${PROJECT_REF}.supabase.co`;

function fail(message) {
  throw new Error(message);
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

function assert(condition, message) {
  if (!condition) fail(message);
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

async function readMessage(baseUrl, key, user, messageId) {
  const query = new URLSearchParams({
    select: "message_id,sender_id,recipient_id,payload",
    message_id: "eq." + messageId
  });
  const { response, data } = await apiRequest(
    baseUrl + "/rest/v1/messages?" + query.toString(),
    key,
    user.accessToken,
    { method: "GET" }
  );
  if (!response.ok) fail(`Inbox read failed (HTTP ${response.status}).`);
  assert(Array.isArray(data), "Inbox query returned an unexpected response.");
  return data;
}

async function assertDirectInsertDenied(baseUrl, key, user, recipientId) {
  const { response } = await apiRequest(
    baseUrl + "/rest/v1/messages",
    key,
    user.accessToken,
    {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        sender_id: user.id,
        recipient_id: recipientId,
        payload: { type: "integration_test_direct_insert" }
      })
    }
  );
  assert(
    response.status === 401 || response.status === 403,
    "Security check failed: direct INSERT into messages was not denied."
  );
}

async function main() {
  const config = readConfig();
  const db = new Client({
    connectionString: config.dbUrl,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000
  });

  const createdUserIds = [];
  let connected = false;

  try {
    await db.connect();
    connected = true;

    const identity = await db.query(
      "select current_database() as db, current_setting('server_version') as version"
    );
    console.log("Connected to VoiceLink Supabase:", identity.rows[0].db, "| PostgreSQL", identity.rows[0].version);

    const owner = await createAnonymousUser(config.url, config.publishableKey);
    createdUserIds.push(owner.id);
    const redeemerA = await createAnonymousUser(config.url, config.publishableKey);
    createdUserIds.push(redeemerA.id);
    const redeemerB = await createAnonymousUser(config.url, config.publishableKey);
    createdUserIds.push(redeemerB.id);
    console.log("Created three temporary anonymous Auth users.");

    const invitationId = crypto.randomBytes(32).toString("base64url");
    await rpc(config.url, config.publishableKey, owner, "create_invitation", {
      p_invitation_id: invitationId
    });
    console.log("PASS: authenticated user can create a 256-bit one-time invitation.");

    const attempts = await Promise.allSettled([
      rpc(config.url, config.publishableKey, redeemerA, "submit_message", {
        p_payload: { type: "integration_test", nonce: crypto.randomUUID() },
        p_recipient_id: null,
        p_invitation_id: invitationId
      }),
      rpc(config.url, config.publishableKey, redeemerB, "submit_message", {
        p_payload: { type: "integration_test", nonce: crypto.randomUUID() },
        p_recipient_id: null,
        p_invitation_id: invitationId
      })
    ]);

    const successful = attempts
      .map((attempt, index) => ({ attempt, user: index === 0 ? redeemerA : redeemerB }))
      .filter(item => item.attempt.status === "fulfilled");
    const rejected = attempts.filter(item => item.status === "rejected");

    assert(successful.length === 1 && rejected.length === 1,
      "One-time invitation race test failed: expected exactly one successful redemption.");
    const rejectionText = String(rejected[0].reason && rejected[0].reason.message || "");
    assert(/invalid or already used|P0001/i.test(rejectionText),
      "The losing redemption did not fail because the one-time invitation had already been consumed.");
    const winner = successful[0].user;
    const messageId = successful[0].attempt.value;
    assert(typeof messageId === "string" && /^[0-9a-f-]{36}$/i.test(messageId),
      "submit_message did not return a message UUID.");
    console.log("PASS: concurrent redemption is atomic; exactly one sender succeeds.");

    const ownerInbox = await readMessage(config.url, config.publishableKey, owner, messageId);
    assert(ownerInbox.length === 1, "Invitation owner cannot read the delivered inbox message.");
    assert(ownerInbox[0].sender_id === winner.id && ownerInbox[0].recipient_id === owner.id,
      "Inbox message sender/recipient routing is incorrect.");
    console.log("PASS: recipient can read the message from their own inbox.");

    const winnerInbox = await readMessage(config.url, config.publishableKey, winner, messageId);
    assert(winnerInbox.length === 0, "Sender can read a message addressed to another user.");
    const loser = winner.id === redeemerA.id ? redeemerB : redeemerA;
    const loserInbox = await readMessage(config.url, config.publishableKey, loser, messageId);
    assert(loserInbox.length === 0, "Unrelated user can read another user's inbox message.");
    console.log("PASS: RLS prevents sender and unrelated user from reading recipient's message.");

    await assertDirectInsertDenied(config.url, config.publishableKey, winner, owner.id);
    console.log("PASS: authenticated clients cannot INSERT directly into messages.");

    const followUpId = await rpc(config.url, config.publishableKey, winner, "submit_message", {
      p_payload: { type: "integration_test_follow_up", nonce: crypto.randomUUID() },
      p_recipient_id: owner.id,
      p_invitation_id: null
    });
    assert(typeof followUpId === "string" && /^[0-9a-f-]{36}$/i.test(followUpId),
      "Existing-contact message did not return a message UUID.");
    const followUp = await readMessage(config.url, config.publishableKey, owner, followUpId);
    assert(followUp.length === 1 && followUp[0].sender_id === winner.id,
      "Existing-contact message was not routed to the recipient.");
    console.log("PASS: existing linked contacts can submit messages through the RPC.");

    console.log("ALL SUPABASE INTEGRATION CHECKS PASSED.");
  } finally {
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
  console.error("Supabase integration test failed:", error.message);
  process.exitCode = 1;
});
