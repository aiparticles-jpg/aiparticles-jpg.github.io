#!/usr/bin/env node
"use strict";

// Read-only diagnostic for one known Supabase Auth identity.
// Does not expose invitation hashes or modify any rows.

const { Client } = require("pg");

const PROJECT_REF = "lcmccpecmtnqknthtijl";
const ownerId = process.env.SUPABASE_DIAG_OWNER_ID;

function assertConfig() {
  const rawUrl = process.env.SUPABASE_URL;
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!rawUrl || !dbUrl || !ownerId) {
    throw new Error("SUPABASE_URL, SUPABASE_DB_URL and SUPABASE_DIAG_OWNER_ID are required.");
  }
  if (new URL(rawUrl).origin !== `https://${PROJECT_REF}.supabase.co`) {
    throw new Error("SUPABASE_URL does not point to the expected VoiceLink project.");
  }
  const db = new URL(dbUrl);
  if (!["postgres:", "postgresql:"].includes(db.protocol) ||
      !db.hostname.endsWith(".pooler.supabase.com") ||
      decodeURIComponent(db.username) !== "postgres." + PROJECT_REF ||
      db.port !== "5432") {
    throw new Error("SUPABASE_DB_URL must be this project's Session pooler URI on port 5432.");
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ownerId)) {
    throw new Error("SUPABASE_DIAG_OWNER_ID must be a UUID.");
  }
}

async function main() {
  assertConfig();
  const db = new Client({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000
  });
  await db.connect();
  try {
    const identity = await db.query("select current_database() as db, current_setting('server_version') as version");
    console.log("Connected to VoiceLink Supabase:", identity.rows[0].db, "| PostgreSQL", identity.rows[0].version);

    const invitation = await db.query(
      "select count(*)::int as count, max(created_at) as latest_created_at " +
      "from public.invitations where owner_id = $1::uuid",
      [ownerId]
    );
    console.log("INVITATIONS_FOR_INVITER_ID:", JSON.stringify(invitation.rows[0]));

    const links = await db.query(
      "select case when user_a = $1::uuid then user_b else user_a end as peer_id, created_at " +
      "from public.links where user_a = $1::uuid or user_b = $1::uuid order by created_at desc",
      [ownerId]
    );
    console.log("LINKS_FOR_INVITER_ID:", JSON.stringify(links.rows));

    const messages = await db.query(
      "select sender_id, recipient_id, created_at, payload->>'type' as message_type " +
      "from public.messages where sender_id = $1::uuid or recipient_id = $1::uuid " +
      "order by created_at desc limit 10",
      [ownerId]
    );
    console.log("RECENT_MESSAGES_FOR_INVITER_ID:", JSON.stringify(messages.rows));
    console.log("READ_ONLY_DIAGNOSTIC_COMPLETE");
  } finally {
    await db.end();
  }
}

main().catch(error => {
  console.error("Supabase read-only diagnostic failed:", error.message);
  process.exitCode = 1;
});
