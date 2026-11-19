#!/usr/bin/env node
"use strict";

// One-time, explicitly invoked Supabase schema migration.
// This script is not imported by server.js and is never run by "npm start".

const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");

const PROJECT_REF = "lcmccpecmtnqknthtijl";
const MIGRATION_FILE = path.resolve(__dirname, "../../supabase/migrations/20261120000000_initial_direct_signaling.sql");

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
  if (!fs.existsSync(MIGRATION_FILE)) fail("Migration SQL file was not found.");
  const sql = fs.readFileSync(MIGRATION_FILE, "utf8");
  if (!sql.trim()) fail("Migration SQL file is empty.");

  const pool = new Pool({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
    max: 1,
    connectionTimeoutMillis: 15000,
    idleTimeoutMillis: 5000
  });

  let client;
  try {
    client = await pool.connect();
    const identity = await client.query(`
      select current_database() as database_name,
             current_setting('server_version') as server_version,
             to_regclass('auth.users') is not null as has_auth_users,
             exists(select 1 from pg_publication where pubname = 'supabase_realtime') as has_realtime
    `);
    const target = identity.rows[0];
    if (!target.has_auth_users || !target.has_realtime) {
      fail("Connected database is missing required Supabase Auth/Realtime objects.");
    }
    console.log("Connected to expected Supabase project.");
    console.log("Database:", target.database_name, "| PostgreSQL:", target.server_version);

    await client.query("begin");
    try {
      await client.query("select pg_advisory_xact_lock(hashtext($1))", ["voicelink:20261120:initial-direct-signaling"]);

      const state = await client.query(`
        select to_regclass('public.invitations') is not null as invitations,
               to_regclass('public.links') is not null as links,
               to_regclass('public.messages') is not null as messages,
               to_regprocedure('public.create_invitation(text)') is not null as create_invitation,
               to_regprocedure('public.submit_message(jsonb,uuid,text)') is not null as submit_message
      `);
      const s = state.rows[0];
      const count = [s.invitations, s.links, s.messages, s.create_invitation, s.submit_message].filter(Boolean).length;

      if (count === 5) {
        const check = await client.query(`
          select (select relrowsecurity from pg_class where oid='public.messages'::regclass) as rls,
                 exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='messages') as realtime
        `);
        if (!check.rows[0].rls || !check.rows[0].realtime) fail("Existing schema failed RLS/Realtime verification.");
        await client.query("commit");
        console.log("Migration already applied; verification passed. No changes made.");
        return;
      }
      if (count !== 0) fail("Partial or conflicting VoiceLink schema found. Refusing automatic changes.");

      await client.query(sql);

      const verified = await client.query(`
        select to_regclass('public.invitations') is not null as invitations,
               to_regclass('public.links') is not null as links,
               to_regclass('public.messages') is not null as messages,
               to_regprocedure('public.create_invitation(text)') is not null as create_invitation,
               to_regprocedure('public.submit_message(jsonb,uuid,text)') is not null as submit_message,
               (select relrowsecurity from pg_class where oid='public.messages'::regclass) as rls,
               exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='messages') as realtime
      `);
      const v = verified.rows[0];
      if (!v.invitations || !v.links || !v.messages || !v.create_invitation ||
          !v.submit_message || !v.rls || !v.realtime) {
        fail("Post-migration verification failed; transaction will be rolled back.");
      }
      await client.query("commit");
      console.log("Migration applied and verified: tables, RPC functions, RLS, Realtime.");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  } finally {
    if (client) client.release();
    await pool.end();
  }
}

main().catch(error => {
  // Never print environment variables, the connection URI, or credentials.
  console.error("Supabase migration failed:", error.message);
  process.exitCode = 1;
});
