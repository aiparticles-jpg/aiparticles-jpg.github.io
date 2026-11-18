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


# VoiceLink identity, invitation, and registration proposal

**Status:** captures the decisions agreed in discussion before the Supabase/ntfy free-plan limit review. Items explicitly marked undecided are not final protocol decisions.

## 7. User data model

The user's identity-related data consists of three values:

| Field | Size / representation | Who knows it | Purpose |
|---|---|---|---|
| `user_id` | 128 bits (16 bytes) | The user's own browser and Render | User identity; also the user's own ntfy topic name |
| `push_subscription_id` | 128 bits (16 bytes; OneSignal UUID value) | The user's own browser and Render | Address used by Render to send OneSignal push notifications |
| `recipient_token` | Encrypted representation of the pair above | The user, Render, and contacts who receive it | Opaque recipient address shared with contacts |

Important distinctions:

- `recipient_token` encrypts the **pair** `(user_id, push_subscription_id)`. It is not merely an encrypted `user_id`.
- The browser keeps its own real `user_id`, its own OneSignal `push_subscription_id`, and the `recipient_token` locally.
- Contacts receive only `recipient_token`; they do not receive either underlying identifier in plaintext.
- Render can decrypt `recipient_token` and recover both values for routing.
- The ntfy topic is exactly the user's own `user_id`. There is no separate `ntfy_topic` field, no SHA-256-derived topic, and no `vl-` prefix.
- The user's real `user_id`/ntfy topic and real OneSignal subscription ID are not disclosed to contacts.

## 8. Invitation contents

The invitation contains these logical fields:

| Field | Representation | Meaning |
|---|---|---|
| `version` | Version field | Invitation format version |
| `recipient_token` | Opaque encrypted token | Encrypted pair `user_id + push_subscription_id` for the person who created the invitation |
| `invitation_id` | 256 bits (32 cryptographically random bytes) | Invitation identifier **and** secret |
| `display_name` | UTF-8 text | Optional/display name carried in the invitation |

Agreed points:

- There is no separate `invitation_secret` field. `invitation_id` itself serves as the secret.
- `invitation_id` is 256 bits (32 random bytes); when represented as Base64URL without padding it is 43 characters.
- The invitation is a compact binary structure, and the complete binary structure is encoded as Base64URL for sharing.
- It is not JSON serialized and then Base64-encoded.
- The invitation carries `recipient_token`, not plaintext `user_id` or plaintext OneSignal `push_subscription_id`.

The exact byte offsets, length encoding, and final binary layout still need to be specified and reviewed. No particular token cipher, nonce layout, or final byte-level envelope is approved by this agreement.

## 9. User registration on Render

The agreed registration flow is:

1. The browser initializes OneSignal and obtains its own real `push_subscription_id`.
2. The browser sends that `push_subscription_id` to the Render backend for registration. It does not choose or submit its own `user_id`.
3. Render generates a new random 128-bit `user_id` (16 bytes). This makes assignment and uniqueness control a backend responsibility rather than trusting client-generated IDs.
4. Render creates `recipient_token` by encrypting the pair `(user_id, push_subscription_id)`.
5. Render returns the newly assigned plaintext `user_id` and the opaque `recipient_token` to the registering browser.
6. The browser stores its own `user_id`, its own `push_subscription_id`, and the returned `recipient_token` locally.
7. The browser subscribes directly to its own ntfy topic, whose name is exactly its own `user_id`.

Registration must not depend on receiving a OneSignal push challenge. A browser/device that cannot receive push notifications must still be able to register. The current decision is that no OneSignal ownership challenge is required as a prerequisite for registration.

## 10. Signaling and notification routing

- Browsers do not send signaling messages or notifications directly to one another.
- Signaling/control messages are sent to Render; Render routes them to the recipient.
- For ntfy delivery, Render decrypts the recipient's `recipient_token`, obtains the recipient's real `user_id`, and publishes to that user's ntfy topic.
- The receiving browser subscribes directly to its own ntfy topic using its locally stored `user_id`.
- Only Render publishes signaling messages to ntfy. Browsers do not publish to other users' topics.
- For OneSignal push, Render decrypts the same recipient token, obtains the real OneSignal `push_subscription_id`, and sends the push using the OneSignal server API. The OneSignal API secret remains on the backend.
- Contacts cannot directly address another user's ntfy topic or OneSignal subscription because those underlying identifiers are not included in the invitation/contact data.
- WebRTC audio/video media remains peer-to-peer. The routing decision above concerns signaling/control messages and push notifications, not proxying the media stream through Render.

## 11. Cryptographic and protocol decisions still open

The following were discussed as options or follow-up design questions, not adopted as final decisions:

- The encryption construction and key management for `recipient_token`. Since Render must decrypt it, the design must allow Render to decrypt it. A symmetric authenticated-encryption design (for example, AES-256-GCM or ChaCha20-Poly1305 with a backend-held key) is one possible approach; an asymmetric design would encrypt to Render's public key and decrypt with Render's private key.
- The exact binary envelope for `recipient_token` and the exact binary invitation layout, including versioning and length fields.
- Whether signaling payloads themselves should be end-to-end encrypted so that Render routes messages without reading their contents.
- Invitation expiry, revocation, replay protection, sender authentication, and backend rate limits.
- How to handle OneSignal subscription changes and re-registration.

These items require separate discussion and explicit agreement before implementation. In particular, example cipher parameters or field layouts proposed during brainstorming must not be treated as approved protocol requirements.

## 12. Relationship to the Supabase experiment

The Supabase Realtime test described in Sections 1–6 is a separate transport experiment. It does not replace or modify the identity, invitation, registration, or routing decisions recorded in Sections 7–11. The working ntfy implementation remains unchanged unless and until a later migration is explicitly approved.
