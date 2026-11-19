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
