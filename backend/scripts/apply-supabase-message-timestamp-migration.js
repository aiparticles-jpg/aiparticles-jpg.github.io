#!/usr/bin/env node
"use strict";

// Applies the message timestamp-only schema migration. Explicit CI/admin task;
// never part of the VoiceLink application startup.

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
  const sqlPath = path.join(__dirname, "../../supabase/migrations/20261120020000_messages_timestamp_only.sql");
  const sql = await fs.readFile(sqlPath, "utf8");
  const db = new Client({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000
  });

  try {
    await db.connect();
    await db.query("begin");
    try {
      await db.query("select pg_advisory_xact_lock(hashtext($1))", ["voicelink:20261120:messages-timestamp-only"]);
      await db.query(sql);
      const result = await db.query(`
        select
          exists (
            select 1 from information_schema.columns
            where table_schema='public' and table_name='messages' and column_name='message_id'
          ) as has_message_id,
          exists (
            select 1 from information_schema.columns
            where table_schema='public' and table_name='messages' and column_name='created_at'
          ) as has_created_at,
          pg_get_function_result('public.submit_message(jsonb,uuid,text)'::regprocedure) as submit_result,
          to_regprocedure('public.broadcast_message_to_inbox()') is not null as has_broadcast_function,
          exists (
            select 1 from pg_trigger
            where tgrelid='public.messages'::regclass
              and tgname='messages_broadcast_insert'
              and not tgisinternal
          ) as has_broadcast_trigger,
          (select relreplident = 'f' from pg_class where oid='public.messages'::regclass) as replica_identity_full
      `);
      const state = result.rows[0];
      if (state.has_message_id || !state.has_created_at || state.submit_result !== "timestamp with time zone" ||
          !state.has_broadcast_function || !state.has_broadcast_trigger || !state.replica_identity_full) {
        throw new Error("Timestamp-only inbox / private Broadcast schema verification failed.");
      }
      await db.query("commit");
      console.log("Supabase inbox migrated: no message_id; created_at retained; submit_message returns created_at; private Broadcast trigger installed; FULL replica identity enabled.");
    } catch (error) {
      if (error.position) {
        const offset = Number(error.position) - 1;
        console.error("SQL parser position:", error.position);
        console.error("SQL around error:", sql.slice(Math.max(0, offset - 120), Math.min(sql.length, offset + 160)));
      }
      await db.query("rollback");
      throw error;
    }
  } finally {
    await db.end();
  }
}

main().catch(error => {
  console.error("Supabase timestamp-only migration failed:", error.message);
  process.exitCode = 1;
});
