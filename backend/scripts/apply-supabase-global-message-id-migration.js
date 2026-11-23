#!/usr/bin/env node
"use strict";

// Applies the global message_id and per-recipient commit-order migration.
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
  const sqlPath = path.join(__dirname, "../../supabase/migrations/20261123010000_messages_global_id_and_recipient_lock.sql");
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
      await db.query("select pg_advisory_xact_lock(hashtext($1))", ["voicelink:20261123:global-message-id"]);
      await db.query(sql);

      const verified = await db.query(`
        select
          c.data_type,
          c.is_identity,
          c.identity_generation,
          exists (
            select 1 from pg_constraint p
            where p.conrelid = 'public.messages'::regclass
              and p.contype = 'p'
              and p.conkey = array[
                (select attnum from pg_attribute
                 where attrelid = 'public.messages'::regclass and attname = 'message_id')
              ]::smallint[]
          ) as is_primary_key,
          to_regclass('public.messages_recipient_message_id_idx') is not null as has_pagination_index,
          pg_get_functiondef('public.submit_message(jsonb,uuid,text)'::regprocedure) as submit_definition
        from information_schema.columns c
        where c.table_schema = 'public'
          and c.table_name = 'messages'
          and c.column_name = 'message_id'
      `);
      if (verified.rowCount !== 1) throw new Error("message_id column is missing after migration.");
      const v = verified.rows[0];
      if (v.data_type !== "bigint" || v.is_identity !== "YES" ||
          v.identity_generation !== "ALWAYS" || !v.is_primary_key ||
          !v.has_pagination_index ||
          !v.submit_definition.includes("FOR UPDATE") ||
          !v.submit_definition.includes("clock_timestamp()")) {
        throw new Error("Global message_id / recipient lock migration verification failed: " + JSON.stringify({data_type:v.data_type,is_identity:v.is_identity,identity_generation:v.identity_generation,is_primary_key:v.is_primary_key,has_pagination_index:v.has_pagination_index,has_for_update:v.submit_definition.includes("FOR UPDATE"),has_clock_timestamp:v.submit_definition.includes("clock_timestamp()")}));
      }
      await db.query("commit");
      console.log("Verified: messages.message_id is BIGINT IDENTITY PRIMARY KEY; recipient/message_id index exists; submit_message locks recipient and uses clock_timestamp().");
    } catch (error) {
      await db.query("rollback");
      throw error;
    }
  } finally {
    await db.end();
  }
}

main().catch(error => {
  console.error("Supabase global message_id migration failed:", error.message);
  process.exitCode = 1;
});
