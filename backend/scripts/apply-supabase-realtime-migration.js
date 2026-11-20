#!/usr/bin/env node
"use strict";

// Applies the VoiceLink private Broadcast inbox authorization policy.
// This is run explicitly by the GitHub Actions integration workflow, never by npm start.

const { Client } = require("pg");
const PROJECT_REF = "lcmccpecmtnqknthtijl";

function fail(message) { throw new Error(message); }

function validateConfiguration() {
  const dbUrl = process.env.SUPABASE_DB_URL;
  const apiUrl = process.env.SUPABASE_URL;
  if (!dbUrl || !apiUrl) fail("SUPABASE_DB_URL or SUPABASE_URL is missing.");

  let db;
  let api;
  try { db = new URL(dbUrl); api = new URL(apiUrl); }
  catch { fail("A Supabase URL environment variable is invalid."); }

  if (api.protocol !== "https:" || api.hostname !== PROJECT_REF + ".supabase.co") {
    fail("SUPABASE_URL does not point to the expected VoiceLink project.");
  }
  if (!["postgres:", "postgresql:"].includes(db.protocol) ||
      !db.hostname.endsWith(".pooler.supabase.com") ||
      decodeURIComponent(db.username) !== "postgres." + PROJECT_REF ||
      db.port !== "5432") {
    fail("SUPABASE_DB_URL must be this project's Session pooler URI on port 5432.");
  }
}

async function main() {
  validateConfiguration();
  const client = new Client({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000
  });

  try {
    await client.connect();
    const identity = await client.query(`
      select to_regclass('realtime.messages') is not null as realtime_messages,
             to_regprocedure('realtime.topic()') is not null as realtime_topic,
             to_regclass('auth.users') is not null as auth_users,
             current_user as database_role
    `);
    const state = identity.rows[0];
    if (!state.realtime_messages || !state.realtime_topic || !state.auth_users) {
      fail("Connected database is missing required Supabase Auth/Realtime objects.");
    }
    if (state.database_role !== "postgres") {
      fail("Refusing to apply Broadcast policy unless connected as the project's postgres role.");
    }

    await client.query("begin");
    try {
      await client.query("select pg_advisory_xact_lock(hashtext($1))", ["voicelink:20261120:realtime-inbox-auth"]);
      await client.query(`
        drop policy if exists realtime_read_own_inbox_topic on realtime.messages;
        create policy realtime_read_own_inbox_topic
          on realtime.messages
          for select
          to authenticated
          using (
            (select realtime.topic()) = 'inbox:' || (select auth.uid())::text
          );
      `);

      const verified = await client.query(`
        select p.polname,
               pg_get_expr(p.polqual, p.polrelid) as using_expression,
               p.polroles
        from pg_policy p
        where p.polrelid = 'realtime.messages'::regclass
          and p.polname = 'realtime_read_own_inbox_topic'
      `);
      if (verified.rowCount !== 1 || !verified.rows[0].using_expression ||
          !verified.rows[0].using_expression.includes("realtime.topic") ||
          !verified.rows[0].using_expression.includes("auth.uid")) {
        fail("Realtime inbox authorization policy verification failed.");
      }
      await client.query("commit");
      console.log("Private Broadcast inbox authorization policy applied and verified.");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  } finally {
    await client.end();
  }
}

main().catch(error => {
  console.error("Supabase Realtime authorization migration failed:", error.message);
  process.exitCode = 1;
});
