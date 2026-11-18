# Supabase Realtime isolated test

This is a temporary transport experiment only. It does not alter VoiceLink's current ntfy signaling, OneSignal push flow, calls, identity, contacts, or invitations.

## Flow

Browser test page -> Render `POST /v1/test/realtime` -> Supabase Realtime Broadcast REST API -> browser test page over Realtime WebSocket.

The browser never publishes directly to Supabase. The test uses a fixed random, non-production topic and dummy text only. No database table is required.

## Render environment variables

Add these to the existing Render backend service:

- `SUPABASE_URL=https://lcmccpecmtnqknthtijl.supabase.co`
- `SUPABASE_SECRET_KEY` = the project's **Secret key** (`sb_secret_...`)

Create/copy the Secret key in Supabase Project Settings -> API Keys. Do not put it in GitHub, the test HTML, or a chat message. The browser uses only the project's Publishable key.

## Test

1. Wait for the Render deployment after this change.
2. Open `https://aiparticles-jpg.github.io/supabase-realtime-test.html` in two browsers/devices.
3. In each page, enter the existing Render backend service URL (the `https://...onrender.com` origin).
4. Wait until both pages show `SUBSCRIBED`.
5. Send a message from one page. The other page should display it.
6. Repeat in Android Chrome and Firefox, including across two devices/networks.

A successful POST response means Render accepted the Supabase REST request; the separate appearance of the message on the other page confirms WebSocket delivery.

The endpoint is rate-limited and accepts only short dummy text. It is an experiment endpoint, not a production signaling API. Remove the endpoint, test page, and Render environment variables after the experiment or before any production migration.
