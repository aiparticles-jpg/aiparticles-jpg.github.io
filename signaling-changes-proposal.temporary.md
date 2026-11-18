# Signaling changes proposal — temporary

**Status:** proposal for an isolated test; not an approved production change.  
**Project:** VoiceLink  
**Purpose:** evaluate Supabase Realtime as a possible replacement for ntfy as the signaling-message transport.

## 1. Agreed scope

- Test Supabase separately, without changing the working VoiceLink application.
- Keep the current ntfy-based signaling path intact during the experiment.
- Do not switch production traffic to Supabase and do not remove ntfy as part of this test.
- Use the test results to decide later whether Supabase is a suitable alternative.

## 2. Proposed test architecture

For the experiment, signaling messages should be routed through the existing Render backend:

1. Browser A sends a signaling message to Render.
2. Render publishes that message to a Supabase Realtime channel using the server-side Supabase credential.
3. Browser B receives the message by subscribing to that channel over Supabase Realtime WebSocket.
4. Browser clients do not publish signaling messages directly to Supabase.

This keeps the publishing authority on the backend and allows the test to compare delivery behavior without changing the WebRTC media path. Audio/video media remains peer-to-peer; this proposal concerns signaling/control messages only.

## 3. Test stages

### Stage 1 — basic transport

- Create a temporary Supabase project and a test channel.
- Use a random, non-production channel/topic identifier.
- Send only harmless test events; do not send real user identifiers, invitation tokens, push subscription IDs, SDP, ICE candidates, or other live signaling data.
- Verify that a browser can subscribe and receive test events.

### Stage 2 — backend-only publishing and access control

- Configure channel access for the intended private-channel model.
- Verify that browser clients can subscribe only where authorized.
- Verify that publishing is performed by Render using a server-side secret.
- Ensure the Supabase secret key is never included in frontend code or sent to browsers.
- Confirm that an unauthenticated or unauthorized browser cannot publish messages to another user's channel.

### Stage 3 — device and network behavior

Test at minimum:
- Android Chrome and Android Firefox.
- Two separate devices where possible.
- Reconnection after temporarily losing network connectivity.
- A receiver that has been idle or whose browser has been backgrounded.
- Delivery after the Render service has been idle or has to wake from sleep.
- Duplicate delivery, ordering, and behavior after reconnecting.

Record connection success, message delivery latency, reconnect behavior, and any browser-specific failures.

## 4. What is explicitly out of scope

- No changes to the production VoiceLink frontend or backend.
- No migration of existing contacts or invitations.
- No change to the current identity, invitation, or recipient-token design.
- No replacement of OneSignal push notifications.
- No proxying of WebRTC audio/video through Supabase or Render.
- No removal of ntfy before the experiment is evaluated.

## 5. Decision after the experiment

Supabase should be considered as a production replacement for ntfy only after:
- the transport works reliably from the target Android browsers and networks;
- private-channel authorization and backend-only publishing are demonstrated;
- idle/background and reconnect scenarios are tested;
- operational limits and free-plan constraints are reviewed separately.

Until that decision is made, ntfy remains the production signaling transport.

## 6. Configuration and secrets

The test will require a Supabase project URL and a browser-safe publishable key where needed for subscription setup. Any Supabase secret/service credential must remain exclusively on the Render backend. Never commit secrets to this repository.

---

This document captures the agreed testing direction only. It does not authorize implementation or production migration.
