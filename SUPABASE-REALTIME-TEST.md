# Direct Supabase inbox test (two browsers)

This isolated browser test exercises the selected VoiceLink signaling architecture against the existing test-stage Supabase schema. It does not change the production application: ntfy, OneSignal, WebRTC calls, contacts, and invitations remain untouched.

## What it verifies

- Each independent browser profile gets its own Supabase Anonymous Auth session.
- Each browser subscribes to Postgres Changes on `public.messages`, filtered to its own `recipient_id`.
- The recipient creates a one-time 256-bit invitation. The database stores only its SHA-256 hash.
- A second browser redeems the invitation using `submit_message()`.
- The database atomically consumes the invitation, creates the contact link, and inserts a durable inbox row.
- The recipient receives the complete Postgres Changes INSERT row (including `payload`) and processes it directly, without a follow-up SELECT on the normal delivery path.
- The sender cannot read the recipient's inbox row (RLS).

No Render endpoint or OneSignal secret is used by this test page. It talks directly to Supabase using the public publishable key and the browser's anonymous Auth JWT.

## Prerequisites already verified

The Supabase migration and the GitHub Actions integration tests have been applied/run for the VoiceLink project. The tests verified invitation redemption, the concurrent one-time-use race, recipient-only inbox reads, blocked direct INSERT, and recipient-only Postgres Changes delivery.

## Run the browser-to-browser test

1. Open [the direct Supabase test page](https://aiparticles-jpg.github.io/supabase-realtime-test.html) in two independent browser profiles or on two devices. For example, use Chrome and Firefox, or a normal and private profile.
2. Wait until both pages show that the Postgres Changes subscription is active. Press **Проверить шифрование** to run the local envelope/AAD self-test.
3. In browser A, press **Создать одноразовое приглашение**. Copy the 43-character invitation ID.
4. Paste that ID into browser B and press **Погасить приглашение и отправить**.
5. Browser B should report that `submit_message()` succeeded and that RLS prevents the sender from reading the inbox row.
6. Browser A should report that the full Realtime INSERT row was processed directly, without a follow-up SELECT.

The test payload is dummy text only. Do not use real call signaling, personal messages, OneSignal IDs, or production invitation data here.

## Test users and cleanup

The page creates or reuses one anonymous Auth user per browser profile. These users are not automatically removed when the tab closes. The GitHub Actions integration tests create their own temporary users and delete them in a `finally` cleanup step, but that cleanup does not delete browser-created users. Remove only the dedicated test users later from Supabase Auth if desired; do not delete real application users.

## Scope and limitations

- This is a browser transport smoke test, not production frontend integration.
- It validates the direct browser → Supabase route without Render. Render may still be retained for OneSignal server-side push.
- The current production ntfy signaling path remains unchanged until the browser test, reconnect/recovery behavior, abuse controls, and migration/rollback plan are reviewed and explicitly approved.
- Anonymous-account abuse controls, invitation/message rate limits, inbox retention, and database quota measurements remain open pre-production tasks.
