# Supabase direct signaling — agreed architecture

**Status:** agreed target architecture for the next implementation stage; not yet deployed to the production VoiceLink application.  
**Project:** VoiceLink  
**Related alternative:** `signaling-changes-proposal.temporary.md` remains preserved as an earlier Render-mediated Supabase Realtime proposal. It is an alternative/reference, not the selected direction in this document.

## 1. Decision and scope

The selected direction is to replace ntfy as the signaling-message transport with direct browser-to-Supabase communication.

- Supabase Anonymous Auth supplies the account/session identity. The Supabase Auth UUID (`auth.uid()`) becomes the VoiceLink network `user_id`.
- The browser keeps its Supabase session, including the refresh token, using the Supabase client session persistence.
- Browsers may submit signaling requests directly to Supabase.
- PostgreSQL validates the authenticated sender, invitation or contact relationship, and routes accepted messages into the recipient's inbox.
- Supabase Realtime **Postgres Changes** notifies the intended recipient about new rows in the inbox table.
- The recipient reads the actual message from the database. A Realtime event is a wake-up/notification, not the durable message itself.
- WebRTC audio/video remains peer-to-peer. Supabase carries signaling/control data only.
- Render is removed from the normal signaling-message path. It may remain for OneSignal server-side push delivery and may be reconsidered as a gate/proxy if anonymous-account abuse cannot be controlled adequately in the database-only design.
- The existing ntfy production path is not removed until the Supabase implementation has been tested and a migration is explicitly approved.

## 2. Identity and registration

On first use, the browser calls Supabase Anonymous Auth (`signInAnonymously()`).

1. Supabase creates an anonymous Auth user.
2. The UUID from `auth.uid()` is the user's VoiceLink `user_id`.
3. The application creates a corresponding row in `public.users`, keyed by that Auth UUID.
4. The browser retains and refreshes its Supabase session through the Supabase client.

The client must not be allowed to choose another user's ID when creating or submitting data. Database functions and policies derive the acting user from the verified JWT via `auth.uid()`.

**Account recovery limitation:** an anonymous Auth identity is tied to its session. If the browser's stored session is lost (for example, site data is cleared), the anonymous account cannot simply be recovered on another device. Recovery/account linking is outside this initial scope.

The existing VoiceLink cryptographic key material and end-to-end payload protection are separate from the Supabase Auth identity. Supabase UUID replaces the former ntfy user/topic ID for routing; it does not imply that private keys or encrypted payloads should be discarded.

## 3. Proposed logical tables

Names and exact SQL types/constraints will be finalized in the migration design. The following is the agreed logical model.

### 3.1 `users`

One row per Supabase Auth user.

- `user_id`: UUID, primary key, references `auth.users(id)`.
- Public-key/profile fields only where needed by the existing VoiceLink cryptographic/contact protocol.
- No server-side address book or local contact aliases. Contact display names remain local to each browser.

### 3.2 `invitations`

A user may have multiple simultaneously valid invitations.

- Store the **SHA-256 hash** of the 256-bit random `invitation_id`, not the raw invitation secret.
- Associate the hash with the invitation owner (`owner_id`).
- Expiration may be supported; the exact lifetime remains to be finalized.
- On successful redemption, atomically find and **DELETE** the invitation row, returning its owner ID for the rest of the transaction.
- Do not retain a redeemed-invitation history or a permanent record of who redeemed whose invitation.
- A failed/expired/nonexistent invitation must not create a link or deliver a message.
- Concurrent redemption attempts must be safe: only one transaction may successfully delete/claim a given invitation row. The deletion and subsequent link/message creation must be in the same transaction so any later failure rolls the deletion back.

Privacy rationale: after successful redemption, the live application table should no longer reveal the invitation hash, owner, or redemption relationship. Operational logs must not record raw invitation values or unnecessary relationship details.

**Storage-erasure qualification:** deleting a PostgreSQL row removes it from normal table queries, but does not promise immediate physical erasure from every underlying storage layer, WAL segment, or provider backup. The retention behavior of provider-managed backups/WAL must be considered separately; do not claim that SQL DELETE is forensic/instant cryptographic erasure.

### 3.3 `links`

Stores established contact relationships.

- One logical relationship connects two Supabase `user_id` values.
- The relationship is bidirectional for signaling authorization: either participant may send to the other.
- Enforce uniqueness so the same pair cannot be created twice.
- Normalize the pair consistently (for example, store the lower UUID in `user_a` and the higher in `user_b`) or otherwise enforce uniqueness independent of direction.
- Creating a link is part of successful invitation redemption and occurs atomically with invitation deletion and delivery of the initial contact message.

### 3.4 `user_messages` (submission/entry table)

Browsers submit a new row here. A database trigger or a narrowly scoped database function processes it.

Logical fields:
- authenticated sender, derived from `auth.uid()` (never trusted from a client-supplied `sender_id`);
- optional `invitation_id` for first-contact requests;
- optional `recipient_id` for messages to an already established contact;
- encrypted/signaling `payload`;
- creation metadata as needed.

Processing rules:

**First contact (invitation path):**
1. Hash the supplied 256-bit invitation ID.
2. Atomically delete the matching unexpired invitation row and obtain its owner ID.
3. Create the bidirectional `links` relationship between the authenticated sender and invitation owner.
4. Route the supplied initial contact-request payload into the invitation owner's inbox.

**Existing contact:**
1. Derive sender from `auth.uid()`.
2. Verify that sender and supplied recipient are connected in `links`.
3. Route the payload into that recipient's inbox.
4. Reject the operation if the relationship does not exist.

The invitation redemption, link creation, and initial inbox insertion must be one transaction. A failure must roll back all of them.

The client must not have direct INSERT privileges on the recipient inbox table. It submits to the controlled entry point; database logic validates and routes the row.

### 3.5 `messages` (recipient inbox)

This is the durable inbox from which recipients read signaling messages.

Logical fields:
- `message_id`: UUID primary key (no auto-increment sequence is currently required);
- `sender_id`;
- `recipient_id`;
- encrypted/signaling `payload`;
- `created_at`.

The inbox row is created only after the database validates the sender and routing permission.

## 4. Message identity, retrieval, and local deduplication

The current agreed direction is deliberately simple:

- Do not add an auto-incrementing sequence solely to track message receipt.
- Do not add server-side per-message read/processed status or ACK fields at this stage.
- Give each message a unique UUID.
- The browser persists received message IDs and message data in its local IndexedDB.
- On a Realtime event, the browser fetches the corresponding row (or fetches pending inbox rows), compares message UUIDs against its local records, and processes only messages it has not already stored.
- After reconnect/reload, the browser queries the recipient's retained inbox and deduplicates against its local IndexedDB records.
- Realtime is not treated as a delivery guarantee. Missed notifications are recovered by querying the inbox.

The exact catch-up query and retention window must be designed so that a reconnect does not accidentally skip rows. If the client has no reliable server-side monotonic cursor, it must not assume that the greatest UUID or latest timestamp proves that every earlier transaction has committed. A safe initial implementation may fetch the recipient's retained inbox (or a deliberately overlapping time range) and deduplicate locally by `message_id`.

Messages are addressed to one recipient. RLS must ensure a user can select only rows where `recipient_id = auth.uid()`. A Postgres Changes subscription filter is an efficiency mechanism, not an authorization boundary; RLS is the security boundary.

## 5. Realtime notification

Use Supabase **Postgres Changes** on `public.messages`, listening for `INSERT`.

- Add `public.messages` to the `supabase_realtime` publication.
- Each browser subscribes to INSERT events filtered by its own `recipient_id`.
- RLS SELECT policy allows the recipient to read only their own inbox rows.
- The Realtime event wakes the recipient's application; the application then reads the actual row from `messages`.
- If the recipient is offline, the inbox row remains stored and is fetched after reconnect.
- Do not call `realtime.send()` for normal message routing.
- Do not depend on Broadcast Replay for durable storage or missed-message recovery.

Postgres Changes delivery and database storage are separate concerns: the durable inbox is the source of truth; Realtime is a best-effort notification path.

## 6. Authorization and cryptography

- Supabase Auth JWT identifies the current session; database logic uses `auth.uid()` as the sender identity.
- RLS controls which inbox rows a user may read.
- The database entry point validates that a sender may contact the recipient by checking `links`.
- Clients cannot write directly into another user's inbox.
- A separate Ed25519/ECDSA signature on every signaling message is **not currently required** for database authorization. The authenticated Supabase identity plus database-enforced relationship and RLS are the selected access-control model.
- This does not remove the existing VoiceLink cryptographic keys, invitation/package integrity checks, or end-to-end encryption requirements. Those serve different purposes from database routing authorization.
- The design must not treat a client-supplied `sender_id` as proof of identity. Sender identity comes from the verified Supabase session.
- Any `SECURITY DEFINER` database function must have a fixed safe `search_path`, minimal privileges, strict input validation, and no ability for clients to bypass the intended entry point.

## 7. Abuse prevention — explicitly unresolved

Anonymous Auth makes account creation easy. Database RLS and relationship checks prevent unauthorized reads and messages to non-contacts, but do not by themselves prevent mass anonymous account creation, invitation spam, or resource exhaustion.

This is an **open security item**, not a solved feature.

Before production release, revisit:
- account-creation abuse and rate limiting;
- invitation creation/redemption rate limits;
- message submission limits and payload-size limits;
- possible CAPTCHA/abuse controls supported by Supabase;
- whether a small Render endpoint should remain in front of sensitive operations to apply the existing request-signature, nonce, and in-memory rate-limiting protections.

If robust abuse prevention cannot be implemented safely at the database/Supabase layer, reconsider routing sensitive writes through Render. This does not change the selected direct-Supabase design for now; it records a decision gate before production.

## 8. Message retention and database storage accounting — explicitly unresolved

- Old signaling messages must be cleaned up according to a defined retention policy.
- The retention duration and cleanup schedule are not yet decided.
- Do not assume that SQL `DELETE` immediately reduces the provider-reported database size.
- PostgreSQL uses MVCC. Deleted/updated rows can leave dead tuples; VACUUM makes reusable space available inside relations, but ordinary VACUUM does not necessarily shrink the relation file or return space to the operating system/provider quota.
- `VACUUM FULL` rewrites the table and can reclaim disk space, but requires an exclusive lock and should not be treated as a routine cleanup mechanism without checking Supabase operational constraints.
- Before relying on the Free plan's database quota, measure actual usage with Supabase's dashboard/usage metrics and PostgreSQL size functions such as `pg_database_size()` and `pg_total_relation_size()`. Compare usage before insertion, after insertion, after deletion, and after vacuum/autovacuum.
- Verify exactly what Supabase counts toward the database quota (table data, indexes, TOAST, internal/system objects, and reclaimed-but-not-returned space) using current documentation and measured project behavior. Do not assume provider-specific accounting or accuse the provider of inflating usage without evidence.
- Set monitoring and cleanup thresholds well below the plan limit.

This concern is important because the project is intended to operate on the Free plan. It must be tested rather than left to guesswork.

## 9. OneSignal and Render responsibilities

- Supabase replaces ntfy for signaling transport; it does not automatically replace OneSignal.
- OneSignal remains the push/alert mechanism unless separately redesigned.
- The OneSignal REST API secret must never be placed in browser code. If push delivery still requires the OneSignal server API, Render may remain as the minimal push-only backend.
- Render is not in the normal database message-routing path in the selected architecture.
- Render may be reconsidered as a gate for registration/invitation/message writes if the abuse-prevention review in Section 7 requires it.

## 10. Implementation and migration constraints

Implement this as a staged migration, not as an immediate destructive replacement.

1. Design and review the SQL schema, RLS policies, trigger/function security, and transactional invitation redemption.
2. Add the schema/migrations and test with two independent anonymous Auth users.
3. Verify that a user can read only their own inbox and cannot insert directly into another user's inbox.
4. Verify that only the intended recipient receives/reads Postgres Changes events.
5. Test concurrent redemption of the same invitation; exactly one attempt must succeed.
6. Test offline recipient, reconnect, duplicate Realtime events, browser reload, and local IndexedDB deduplication.
7. Measure database growth, deletion, vacuum behavior, and actual quota accounting.
8. Test anonymous-account abuse controls and decide whether Render must gate writes.
9. Only after the tests pass, migrate the production frontend from ntfy to Supabase. Keep a rollback path until the new transport is validated.

No existing production ntfy code, OneSignal behavior, WebRTC media path, or working UI should be removed as part of the initial schema/test implementation.

## 11. Decisions intentionally deferred

- Exact invitation expiry duration and cleanup schedule.
- Exact SQL column types, constraints, indexes, and function signatures.
- Exact payload envelope and message-type validation.
- Whether the initial contact-request payload is byte-for-byte identical to the existing protocol envelope or requires a versioned wrapper.
- Message retention duration and cleanup implementation.
- Exact inbox catch-up query strategy and practical local IndexedDB retention.
- Rate limits and anonymous-account abuse controls.
- Provider-managed WAL/backup retention and the limits of physical deletion.
- Whether OneSignal push delivery remains unchanged or is redesigned later.
- Whether the older Render-mediated Supabase alternative offers advantages worth revisiting.

---

This document records the selected design and its unresolved risks. It is not evidence that the schema or migration has already been deployed.


## 12. Implementation decisions confirmed on 2026-11-20

This section supersedes conflicting details in the earlier logical draft above.

- **No `public.users` table.** The initial implementation uses Supabase Auth UUIDs directly via `auth.uid()`. No second VoiceLink user identifier is stored in the new signaling database. Revisit a separate durable/cryptographic identity only closer to production, if it becomes necessary.
- **Invitation format:** one random 256-bit `invitation_id`, represented as 43-character unpadded base64url. It is the secret itself. There is no separate `invitation_secret`.
- **Invitation storage:** the database stores only SHA-256 of the exact base64url invitation ID. A successful redemption deletes that row in the same transaction that creates the link and inserts the initial inbox message.
- **No submission/staging table in the first SQL implementation.** Browser writes go through narrowly scoped `create_invitation()` and `submit_message()` RPC functions. Clients cannot insert directly into `messages` or read invitation/link tables.
- **Initial tables:** `invitations`, `links`, and `messages`. No read/processed status, ACK, auto-increment sequence, or redeemed-invitation history.
- **Initial invitation expiry:** not implemented yet; expiry duration and cleanup remain a later decision.
- **Message retention and abuse/rate limits:** not solved by this initial schema and remain mandatory pre-production review items.

The SQL migration is a test-stage artifact only. It must be applied and verified in the Supabase project before any frontend integration. It does not alter the production ntfy path, OneSignal backend, WebRTC media path, or current invitation format.

## 13. Simplified transport and message protocol — decisions confirmed 2026-11-20

This section records decisions made after the two-browser Supabase Auth, invitation, RLS, durable-inbox, and private Realtime test. It supersedes conflicting earlier statements in Sections 2, 4, 5, 6, and 12. These are agreed implementation requirements, not yet implemented in the production frontend or SQL migration.

### 13.1 One network identity only

- Supabase Anonymous Auth UUID is the only network identity used by the new signaling protocol.
- Do not create, retain, transmit, or require the former separate 64-hex-character VoiceLink user_id for this transport.
- The browser knows its own Supabase UUID from its authenticated Supabase session. Application code does not need a second locally generated self-ID.
- Each local contact record stores that contact's Supabase Auth UUID as its network routing key.
- The browser maintains a local mapping from incoming database sender_id (Supabase UUID) to the corresponding IndexedDB contact record, including the local alias and other local-only fields.
- Contact aliases, avatars, local contact record IDs, and other local address-book data never leave the browser.
- OneSignal Subscription ID remains a separate push-notification identifier. It is not a signaling identity and is not used as a replacement for the Supabase UUID.
- Database functions derive the sender from the verified JWT using auth.uid(). Never trust a client-supplied sender_id.

### 13.2 Invitation ID: hash once in the database

The browser generates and transmits the original random invitation ID. It does not hash the value before sending it to Supabase.

1. The inviter's browser generates exactly 32 cryptographically random bytes using a cryptographically secure random generator.
2. The browser encodes those 32 bytes as unpadded Base64URL. The resulting invitation ID is exactly 43 characters.
3. The browser sends this original 43-character value as p_invitation_id to create_invitation(), and shares the same value with the intended invitee as the one-time bearer invitation credential.
4. Supabase validates the expected 43-character Base64URL format and stores SHA-256(UTF8(invitation_id)), a 32-byte digest, together with the inviter's auth.uid(). The raw invitation ID is not stored in the invitations table.
5. During redemption, the invitee submits the original 43-character invitation ID as p_invitation_id. submit_message() calculates the same SHA-256(UTF8(invitation_id)) and atomically deletes the matching row with DELETE ... RETURNING owner_id.

There is exactly one hash operation, performed inside the database for both creation and redemption. Do not hash the invitation ID in the browser, and do not introduce a second hash.

The invitation ID is a bearer secret: anyone who obtains it can attempt to redeem the invitation. HTTPS is mandatory, and raw invitation values must not be written to application logs, analytics, or error reports. Storing only its SHA-256 digest protects against disclosure of the live invitations table alone; it does not protect against compromise of an active Supabase service or a client/session that can observe redemption requests.

The existing RPC parameter name p_invitation_id remains appropriate. Its documented meaning is the original 43-character Base64URL encoding of 32 random bytes. The create and redemption RPCs must hash the exact same UTF-8 representation.

### 13.3 Realtime event carries the message; no SELECT per notification

- A Postgres Changes INSERT event for public.messages is expected to contain the inserted row, including its payload.
- The recipient processes the row carried by the Realtime event directly. Do not issue a second SELECT by message_id for every normal notification.
- The private Realtime channel and RLS remain in force. The recipient subscription is filtered by its own recipient_id; the RLS policy remains the actual authorization boundary.
- The durable inbox row remains the source of truth. Realtime is a notification/delivery path, not a guarantee that every event reaches an offline or disconnected browser.
- On ordinary successful delivery, one database write and one Realtime event are sufficient; there is no follow-up read.
- A database read is reserved for recovery: after reconnect/reload when messages may have been missed, or when the browser detects a sequence gap. The recovery query fetches a suitable overlapping range of the recipient's inbox (optionally narrowed by sender_id and created_at), then the browser decrypts, orders, and deduplicates locally. The exact overlap/retention strategy must be finalized during implementation so timestamp boundaries cannot cause missed rows.
- Test that the deployed Supabase Postgres Changes configuration actually supplies the full INSERT row under the project's RLS/private-channel configuration before removing the test page's existing read-after-notification step.

### 13.4 Message ordering and deduplication are client responsibilities

- Do not add a database sequence, per-message read/processed flag, ACK table, or server-side ordering state.
- Put a monotonically increasing sequence number inside the encrypted plaintext for each sender-to-recipient direction. Each direction has its own counter.
- Persist the next outgoing counter and last successfully processed incoming counter in IndexedDB, associated with the local contact record / peer Supabase UUID.
- Use a representation that cannot exceed JavaScript's safe integer range; a decimal string representing an unsigned 64-bit integer is the preferred wire representation.
- Increment and persist the outgoing counter atomically before publication, so reloads or multiple tabs do not reuse a number. The implementation must serialize concurrent sends for the same peer.
- The recipient decrypts the message before inspecting its sequence number. It ignores already-processed duplicates, processes the next expected number, and detects a gap when a higher number arrives before the expected one.
- On a gap, buffer later messages and perform the recovery read described in Section 13.3. Do not advance the last-processed counter past a gap until missing messages have been recovered or an explicit, separately designed recovery policy is applied.
- Realtime may redeliver events or the application may process them again after reconnect. Keep the database-generated message_id UUID as an internal row identity and local deduplication key; it is not a sequence number, read receipt, or ordering mechanism.
- Do not assume UUID ordering or timestamps alone prove that no message is missing.

### 13.5 Minimal encrypted message envelope

The previous outer envelope fields type, payload.from, and payload.to are not needed in the new Supabase transport:

- Sender identity is supplied by the database row's sender_id, derived from auth.uid().
- Recipient identity is supplied by the database row's recipient_id, validated by submit_message().
- Message type (for example hello, answer, cancel, reject, data, text, or delivery receipt) belongs inside the encrypted plaintext, not in the clear outer envelope.
- The protocol version remains outside encryption so the receiver can select the correct decryption/decoding procedure before decrypting. The version is also included in AES-GCM Additional Authenticated Data (AAD), so it cannot be changed without authentication failure.

The minimal logical JSONB payload is:

    {
      "v": 1,
      "data": "<base64url of 12-byte IV || AES-256-GCM ciphertext || 16-byte GCM tag>"
    }

The decrypted plaintext is a versioned application message, conceptually:

    {
      "type": "data",
      "seq": "42",
      "body": {
        "...": "message-type-specific fields"
      }
    }

The exact binary framing and plaintext field names may be finalized in implementation, but the following requirements are fixed:

- The only clear envelope metadata is the protocol version and the encrypted data field.
- Do not expose from, to, or message type in the payload envelope.
- The IV is 12 cryptographically random bytes and the GCM tag is 16 bytes. The IV must never be reused with the same encryption key.
- The receiver obtains sender and recipient UUIDs from the authenticated database row. Bind the version and both routing UUIDs into AES-GCM AAD on both encryption and decryption. This authenticates the database routing context without duplicating from/to inside the envelope.
- The receiver decrypts first, then validates the inner message type, sequence number, and type-specific body.
- A version that the receiver does not support is rejected without attempting to interpret it as another version.
- Existing VoiceLink contact AES-GCM/HKDF key derivation and key-rotation behavior must be reviewed and adapted to the new routing context; do not silently assume the old ntfy envelope AAD can be reused unchanged.

### 13.6 Normal message submission and delivery

For an established contact:

1. The sender looks up the peer's Supabase UUID in its local contact record.
2. It constructs the inner message with type, per-peer-direction seq, and message-specific body.
3. It encrypts the plaintext locally using the contact's existing E2EE key material and the new version/routing AAD.
4. It calls submit_message(p_payload, p_recipient_id, null). The sender UUID is not supplied; PostgreSQL derives it from auth.uid().
5. The database verifies the existing bidirectional links relationship and inserts the inbox row.
6. Supabase Realtime delivers the INSERT row, including the encrypted payload, to the recipient's authorized private subscription.
7. The recipient maps row sender_id to its local contact, decrypts the payload, checks type and seq, and processes it. No per-message SELECT is performed on this normal path.

### 13.7 Scope and migration status

- These decisions update the target protocol specification only. They do not yet change the current SQL migrations, test page, or production ntfy signaling implementation.
- The existing two-browser test proved the current test implementation's invitation redemption, RLS, durable inbox, and private Realtime notification. It did not yet prove full-row direct processing without SELECT, the revised single-hash invitation flow, the new envelope, sequence-gap recovery, or an actual VoiceLink call.
- Implement the SQL and browser changes together in a new test stage. Keep the existing production ntfy path intact until the revised protocol passes browser tests and a real two-device call.


## 14. Implementation progress — 2026-11-20

This section records code that has been implemented and verified after the protocol decisions above.

### 14.1 Database-side invitation hashing and full-row Realtime delivery

- The browser creates the original 32-byte random invitation ID and sends its 43-character unpadded Base64URL representation directly to `create_invitation()` or `submit_message()`.
- PostgreSQL computes SHA-256 once for storage and once on redemption input; only the digest is stored in `public.invitations`.
- The integration test now checks the stored value equals exactly SHA-256 of the original ID and is not a double hash.
- The browser test page processes `event.new` from the Postgres Changes INSERT directly. It no longer performs a per-notification SELECT.
- The Node integration test confirms the actual Realtime event contains the complete inserted row, including `payload` and `created_at`, and confirms that the event is delivered only to the intended recipient.

### 14.2 Isolated version-1 E2EE envelope helper

Implemented in `js/supabase-protocol.mjs`. This is an isolated protocol module and is not yet connected to the production VoiceLink signaling path.

- `createInvitationId()` generates the original 32 random bytes and Base64URL-encodes them. It performs no hashing.
- `encryptSupabaseMessage()` accepts the shared 32-byte contact secret, sender and recipient Supabase UUIDs, and an inner `{type, seq, body}` message.
- The outer payload is exactly `{v: 1, data: ...}`, with data encoding the 12-byte IV followed by AES-GCM ciphertext and its 16-byte tag.
- HKDF-SHA-256 derives a directional AES-256-GCM key from the shared contact secret. The pair UUIDs determine the salt; ordered sender and recipient UUIDs determine the direction-specific HKDF info.
- AES-GCM AAD binds protocol version, sender UUID, and recipient UUID.
- `decryptSupabaseMessage()` obtains those UUIDs from the database row context, rejects unsupported versions, malformed envelopes, modified ciphertext, invalid sequence values, and plaintext that includes top-level `from` or `to`.
- Sequence values are decimal strings bounded to unsigned 64-bit range. This helper validates them; persistent IndexedDB sequence allocation/processing has not yet been implemented.

### 14.3 Automated verification

GitHub Actions run `44704710294` succeeded. It ran:
- the isolated E2EE envelope test (round-trip, tamper rejection, unsupported-version rejection, AAD sender/recipient binding, uint64 bounds, no clear `from/to`);
- the Supabase integration flow (single-hash invitation storage, concurrent one-time redemption, RLS, blocked direct INSERT, existing-contact RPC routing);
- the Postgres Changes test (complete INSERT row, direct delivery without follow-up SELECT, recipient-only delivery).

The GitHub Pages deployment for the updated browser test page also succeeded (run `44704764777`).

### 14.4 Not yet implemented

- The new envelope helper is not wired into `app.js` or the existing `NtfySecureSignaling` implementation.
- Production contacts still use the legacy 64-hex ntfy identity as their IndexedDB primary key; the separate Supabase UUID routing field and migration/import path are not yet implemented.
- Supabase session initialization in the production app is not yet implemented.
- Persistent outgoing/incoming sequence state, pending-send retry behavior, gap buffering, and inbox recovery are not yet implemented.
- No production signaling, invitation UI, OneSignal, WebRTC, or ntfy code has been switched or removed.

Keep the production ntfy path unchanged until the new transport is integrated and validated with two independent devices and a real call.


## 15. Production-app Supabase identity bootstrap — 2026-11-20

Implemented in the existing static app without switching its active signaling transport.

### 15.1 Supabase Anonymous Auth in the app

- The production page loads the same Supabase JS v2 browser SDK used by the isolated test page.
- `js/supabase-client.js` creates a Supabase client for the VoiceLink project using only the public publishable key. No service-role key or database password is present in browser code.
- Anonymous Auth session persistence uses a dedicated storage key, `voicelink-supabase-auth-v1`, separate from other browser storage.
- On app startup, `getSupabaseIdentity()` restores the existing anonymous session or creates one, then exposes its Supabase Auth UUID.
- If Supabase Auth is temporarily unavailable, startup logs the problem and the existing ntfy application continues to initialize. Supabase failure does not block the legacy calling path.

### 15.2 Supabase identity in contact invitations

- Newly generated contact invitations now attempt to create a one-time Supabase invitation via `create_invitation()`.
- The invitation package includes `supabase_user_id` and `supabase_invitation_id` when that RPC succeeds. The invitation ID is the original random 32-byte Base64URL value; the browser does not hash it. PostgreSQL stores only its single SHA-256 digest.
- Contact-package verification validates these fields and retains them in the local contact record.
- Encrypted contact-response packages include the sender's `supabase_user_id`, allowing the other side to learn the same routing identity after the existing ntfy contact exchange.
- Local contact records retain their current legacy `user_id` primary key temporarily for compatibility with ntfy. The new `supabase_user_id` is a separate routing field. `findContactBySupabaseUserId()` provides the reverse lookup needed by the future inbox adapter.
- The diagnostic identity line now displays a short Supabase UUID prefix or indicates that Supabase Auth was unavailable.

### 15.3 Verification boundary

- GitHub Pages deployment for this code completed successfully (run `44706223338`).
- The earlier Supabase integration tests prove Anonymous Auth and the `create_invitation()` RPC against the same project, but the new production-app bootstrap has not yet been exercised in a real browser session after deployment.
- This step does not redeem `supabase_invitation_id`, submit an E2EE message through Supabase, subscribe the production app to Realtime, or change WebRTC/ntfy call signaling.
- The legacy 64-hex local identity remains only as a compatibility key for the still-active ntfy implementation. It must not be sent as sender/recipient identity in the new Supabase transport.
- Unused Supabase invitation rows currently remain as SHA-256 digests until redeemed. An explicit revoke/expiry cleanup path is still to be designed; do not claim these invitations are revoked when a local invitation is replaced or deleted.

Keep ntfy active until the next steps implement initial invitation redemption, inbox subscription/recovery, and the real two-device signaling flow.

## 16. First-contact Supabase redemption in the production app — 2026-11-20

Implemented in the production browser app while preserving the existing ntfy exchange.

- Added `submitSupabaseInvitationAcceptance()` to `js/supabase-client.js`.
- Immediately after a newly imported contact is saved, the app makes one attempt to redeem the verified contact's `supabase_invitation_id`. At startup it also checks already-saved contacts and makes the same one-time attempt for any contact not previously attempted. The ntfy contact-response path does not redeem the Supabase invitation.
- The first Supabase message uses the existing 32-byte `invitation_secret` as shared E2EE key material and the version-1 Supabase envelope. Its encrypted plaintext is `{type:"contact_accept",seq:"1",body:{}}`.
- The sender UUID is obtained from the current Supabase Auth session. The recipient UUID and one-time invitation token come from the verified contact package. The client calls `submit_message(p_payload, null, p_invitation_id)`; it does not send a client-selected sender UUID.
- A successful RPC atomically consumes the one-time token, creates the bidirectional `links` row, and inserts the encrypted first message into the inviter's durable inbox.
- Before the RPC call, the invitee persists `supabase_invitation_attempted_at`. A failed or interrupted attempt is not retried automatically; this deliberately avoids reusing a one-time bearer token, but it means a transient failure requires a fresh invitation exchange. A successful call also stores `supabase_invitation_redeemed_at`. Raw invitation tokens are not logged.
- If the invitation has no Supabase fields, the app continues with ntfy only. If Supabase submission fails, the legacy ntfy exchange remains operational and the failure is recorded in the diagnostic log.
- The production app now subscribes to the authenticated user's private `inbox:<uuid>` Realtime channel, filtered to `recipient_id`. It processes the full `event.new` row without a per-event SELECT.
- On each successful Realtime subscription (including reconnect), the app reads up to 500 rows from the durable inbox to recover missed notifications. Processed message UUIDs are persisted locally (bounded to the latest 2,000 IDs) to suppress duplicates.
- The first `contact_accept` message is decrypted using the contact's shared invitation secret and the sender/recipient UUIDs from the database row. Successful processing marks the contact as accepted in local metadata. Other message types are currently not connected to call/chat handlers.
- Normal Supabase call signaling, persistent per-peer sequence allocation/gap recovery, and real two-device call testing remain outstanding.
- GitHub Actions syntax check passed for commit `031e74cd779ac66a50b94e1df80cd5145cccc310` (run `44714979485`); GitHub Pages deployment also succeeded (run `44714979359`).

This is a staged dual-write/first-contact bridge, not a completed ntfy replacement. Keep ntfy active until inbox processing and a real two-device call work over Supabase.
