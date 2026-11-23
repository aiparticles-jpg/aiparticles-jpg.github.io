#!/usr/bin/env node
"use strict";

// Applies the recipient-scoped inbox sequence migration.
// Explicit GitHub Actions task; never part of VoiceLink application startup.

const fs = require("node:fs/promises");
const path = require("node:path");
const { Client } = require("pg");
const PROJECT_REF = "lcmccpecmtnqknthtijl";

function validateConfiguration() {
  const dbUrl = process.env.SUPABASE_DB_URL;
  const apiUrl = process.env.SUPABASE_URL;
  if (!dbUrl || !apiUrl) throw new Error("SUPABASE_DB_URL or SUPABASE_URL is missing.");
  const db = new URL(dbUrl);
  const api = new URL(apiUrl);
  if (api.protocol !== "https:" || api.hostname !== PROJECT_REF + ".supabase.co") {
    throw new Error("SUPABASE_URL does not point to the expected VoiceLink project.");
  }
  if (!["postgres:", "postgresql:"].includes(db.protocol) ||
      !db.hostname.endsWith(".pooler.supabase.com") ||
      decodeURIComponent(db.username) !== "postgres." + PROJECT_REF ||
      db.port !== "5432") {
    throw new Error("SUPABASE_DB_URL must be this project's Session pooler URI on port 5432.");
  }
}

async function main() {
  validateConfiguration();
  const sqlPath = path.join(__dirname, "../../supabase/migrations/20261123020000_messages_recipient_sequence.sql");
  const sql = await fs.readFile(sqlPath, "utf8");
  const db = new Client({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000
  });

  try {
    await db.connect();
    const identity = await db.query(`
      select current_user as database_role,
             to_regclass('public.messages') is not null as has_messages,
             to_regclass('auth.users') is not null as has_auth_users,
             to_regclass('public.links') is not null as has_links,
             to_regclass('public.invitations') is not null as has_invitations
    `);
    const state = identity.rows[0];
    if (state.database_role !== "postgres" || !state.has_messages ||
        !state.has_auth_users || !state.has_links || !state.has_invitations) {
      throw new Error("Connected database is not the expected VoiceLink Supabase schema / postgres role.");
    }

    await db.query("begin");
    try {
      await db.query("select pg_advisory_xact_lock(hashtext($1))", ["voicelink:20261123:recipient-sequence"]);
      await db.query(sql);

      const verified = await db.query(`
        select
          exists (
            select 1 from information_schema.columns
            where table_schema='public' and table_name='messages'
              and column_name='recipient_seq' and data_type='bigint' and is_nullable='NO'
          ) as has_recipient_seq,
          to_regclass('public.recipient_counters') is not null as has_counters,
          to_regclass('public.messages_recipient_seq_uidx') is not null as has_unique_index,
          pg_get_functiondef('public.submit_message(jsonb,uuid,text)'::regprocedure) as submit_definition,
          exists (
            select 1
            from public.messages m
            left join public.recipient_counters c on c.recipient_id=m.recipient_id
            where c.recipient_id is null or c.last_seq < m.recipient_seq
          ) as counter_behind_message,
          exists (
            select 1
            from (
              select recipient_id, recipient_seq,
                     row_number() over (partition by recipient_id order by recipient_seq) as expected
              from public.messages
            ) ordered
            where recipient_seq <> expected
          ) as has_sequence_gap
      `);
      const v = verified.rows[0];
      if (!v.has_recipient_seq || !v.has_counters || !v.has_unique_index ||
          !v.submit_definition.toLowerCase().includes("recipient_counters") ||
          !v.submit_definition.toLowerCase().includes("clock_timestamp()") ||
          v.counter_behind_message || v.has_sequence_gap) {
        throw new Error("Recipient sequence migration verification failed: " + JSON.stringify(v));
      }
      await db.query("commit");
      console.log("Verified: recipient_seq is non-null and unique per inbox; counters are current; submit_message allocates recipient_seq transactionally.");
    } catch (error) {
      await db.query("rollback");
      throw error;
    }
  } finally {
    await db.end();
  }
}

main().catch(error => {
  console.error("Supabase recipient sequence migration failed:", error.message);
  process.exitCode = 1;
});
