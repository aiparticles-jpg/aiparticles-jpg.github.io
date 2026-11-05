# Voicelink — Project Session Checkpoint

This file is a continuity checkpoint for future ChatGPT sessions. Treat the repository documents as the source of truth; do not rely on compressed chat context alone.

Repository: https://github.com/aiparticles-jpg/aiparticles-jpg.github.io
Main architecture: [ARCHITECTURE.md](./ARCHITECTURE.md)

## Working rules
- Before changing code, inspect the current repository state.
- Discuss and agree architecture before implementation.
- Never claim a GitHub write succeeded until the file has been fetched again and the saved content verified.
- After each substantial new decision, update the relevant repository document and verify it by reading it back.
- If a write fails, preserve the decision in a separate checkpoint/decision file or report the failure explicitly. Do not silently assume it was saved.

## Project
Anonymous peer-to-peer voice application.
- Frontend: GitHub Pages.
- OneSignal: push notifications.
- ntfy: call signaling and WebRTC signaling.
- WebRTC: direct audio transport.
- Render: stateless HTTP backend to validate signed requests and send OneSignal pushes.
- No database or persistent server-side user/contact data.
- Cloudflare Workers are excluded due to connectivity problems with free workers.dev URLs in the user's environment and the cost of a custom domain.
- Render Free may sleep; cold starts must be considered.

## Agreed identity and contacts
- No separate random UUID.
- Generate ECDSA P-256 key pair on first use.
- user_id is SHA-256 fingerprint of the public key.
- Private key stays in the browser; public key can be shared.
- Contact aliases are local only and are never sent over the network.
- Local contact fields: name (alias), user_id, public_key, push_subscription_id (OneSignal Subscription ID).
- Contact exchange supports both QR code and URL fragment (#contact=...). The fragment is read by frontend JavaScript and is not sent in the HTTP request.
- Contact package includes user_id, public_key, push_subscription_id, version, and signature; never includes the private key.
- ECDSA signature covers the package fields. Validate the fingerprint and signature on import. Initially mark imported contact unconfirmed; verify SAS on first connection before trusting it.
- If OneSignal Subscription ID changes, share an updated contact package.

## Latest agreed private-key storage decision (not yet recorded in ARCHITECTURE.md or implemented)
- Generate the private key using Web Crypto API as non-extractable.
- Store the CryptoKey object in IndexedDB.
- Do not export private-key material to JWK or store it in localStorage.
- Use the stored CryptoKey directly for signing contact packages and authenticated backend requests.
- Public key remains exportable for sharing.
- Compatibility and browser behavior still need to be verified during implementation.

## Backend security baseline
- ECDSA P-256 request signatures.
- Validate user_id against SHA-256 fingerprint of supplied public key.
- Timestamp with 60-second acceptance window.
- Random nonce and temporary in-memory replay tracking.
- Rate limits by IP and user_id.
- Only explicitly allowed event types; no arbitrary client-supplied OneSignal message text or parameters.
- No persistent user data on backend.
- Example limits discussed (not finalized): nonce retention 2 minutes, 10 requests/minute per IP, 5 requests/minute per user_id.
- In-memory state is lost on restart and not shared between instances; this is basic mitigation, not distributed rate limiting.

## Push events and call UI
Allowed push events:
- incoming_call
- call_cancelled
- call_ignored

Push payload should contain minimal metadata (event, sender_id, call_id, expires_at). Do not send names, SDP, audio, private keys, or sensitive data through OneSignal.
- Starting a call: send incoming_call through Render/OneSignal alongside ntfy signaling.
- Caller cancels: send call_cancelled.
- Recipient explicitly rejects: send call_ignored.
- Answer is delivered through ntfy; no separate push.
- Hiding/dismissing the incoming-call UI is local only and must not notify the caller.

Three distinct incoming-call actions are agreed:
- Answer: accept.
- Reject: explicitly reject; notify via Render/OneSignal and ntfy; caller stops waiting.
- Hide: close UI locally; caller continues waiting.

## Current implementation status / open questions
- These are architecture decisions, not proof of implementation.
- Reject button/event handling has not been implemented or verified.
- Exact rate-limit values are not finalized.
- The non-extractable IndexedDB CryptoKey approach is agreed but not implemented or compatibility-tested.
- Open question to discuss next: what should happen if browser data is cleared, the browser is reinstalled, or the user changes device and loses the non-extractable private key? Possible consequences include creating a new identity; recovery/backup would require a separate security design.
- Before coding, inspect the current repository files and reconcile them with this document.

## Identity recovery after private-key loss

If the browser's IndexedDB data is cleared, the browser is reinstalled, or the user moves to another device without transferring the existing key, the non-extractable private key may be permanently lost. In that case:

- The application generates a new ECDSA P-256 key pair and derives a new `user_id` from the new public key.
- The previous identity cannot be recovered.
- The user must share the new contact package (QR code or URL) with contacts again.
- Contacts must verify and trust the new identity; the old identity must not be silently treated as the new one.
- No private-key backup, export, password-encrypted recovery file, or device-to-device key transfer is provided in this design.

This is an intentional trade-off: simpler recovery behavior and preservation of the non-extractable private-key design, at the cost of losing the old identity when its key is lost.

## Handling stale contacts after identity loss

When a user loses their private key and creates a new cryptographic identity:

- Existing contact records are not deleted automatically.
- The old contact identity is marked as `Identity outdated`.
- The old `user_id` and public key are retained as historical contact data, but must not be used to establish a new connection as though they represented the user's current identity.
- The user shares the new contact package (QR code or URL) with their contacts.
- The recipient imports the new package and verifies the new identity before trusting it.
- The application must not automatically link the old and new identities: without the old private key, cryptographic proof of continuity is unavailable.
- After the recipient has independently verified the new identity, the UI may offer to replace the outdated identity in the existing local contact record while preserving that contact's locally assigned name. This replacement is an explicit user action, not an automatic merge.

## SAS verification for a re-imported contact

When a contact imports a user's new contact package after that user has lost their previous private key and created a new identity, the same Short Authentication String (SAS) verification mechanism agreed for first-time contact verification is used. Both users compare the SAS through an independent communication channel and confirm that it matches before marking the new identity as trusted. The new identity is not automatically linked to the old one; replacing an outdated local contact identity remains an explicit user action after successful verification.


## Startup behavior and local-only data

On application startup:

- Check IndexedDB for the locally stored non-extractable private key.
- If present, load and use the existing cryptographic identity.
- If absent, generate a new ECDSA P-256 key pair and derive a new `user_id` from its public key.
- Retain and use locally stored contacts if they are still available.
- If browser data was cleared and the local address book is also absent, the user must import contacts again.

There is no cloud synchronization or cloud backup for identity or contacts, and no cross-device synchronization is included in the agreed architecture.


## Local storage decision: IndexedDB

Use IndexedDB as the local storage mechanism for identity and contacts. Store:

- The non-extractable private `CryptoKey` object.
- The public key and derived `user_id`.
- Contact records: local alias, `user_id`, public key, and OneSignal Subscription ID.
- Contact trust status and SAS-verification status.

Do not store identity or contact data in `localStorage`. Keep this data local to the device; do not add cloud synchronization or a persistent backend address book.


## Local contact-data encryption decision

Do not add application-level encryption for contact records stored in IndexedDB; keep this storage simple. The private key remains a non-extractable Web Crypto `CryptoKey` stored in IndexedDB. IndexedDB itself must not be described as encrypting the contact records.


## Inactive OneSignal Subscription ID

Keep contacts when their OneSignal Subscription ID becomes inactive, invalid, or stops receiving notifications. Do not automatically delete the contact or its local name/trust record. Allow the user to refresh the contact's push details by exchanging an updated QR code or URL when available. An inactive Subscription ID alone is not grounds for deleting the contact.


## OneSignal Subscription ID rotation

When OneSignal assigns the user a new Subscription ID, update the user's own value in IndexedDB and generate a newly signed contact package with the current `push_subscription_id`. Make it available for sharing through the existing QR-code or URL flow. Contacts on other devices are not updated automatically; they must import the refreshed package. A Subscription ID change alone does not create a new cryptographic identity.


## Browser notification permission denied

When browser notification permission is denied or blocked, show an in-app warning that push notifications are unavailable and incoming-call alerts may not arrive while the app is inactive. Offer instructions for enabling notifications in browser site settings. Do not repeatedly prompt or bypass the user's choice. Keep other Voicelink functionality available where technically possible; lack of push permission alone must not block app use.


## Notification permission request timing

Do not request notification permission automatically on first page load. Explain the purpose first and request permission only after the user explicitly presses an `Enable notifications` button. If permission is denied or blocked, show the warning and guidance already agreed.

## Render backend wake-up / keep-alive

Render may put the backend to sleep after approximately 15 minutes of inactivity. The frontend should:

- Send a lightweight backend request on application startup to wake it if necessary.
- Send a lightweight ping approximately every 14 minutes while the application is active.
- Stop periodic pings when the application is closed or no longer running.
- Send a fresh request immediately when the user returns after an absence.

Mobile browsers and operating systems can throttle or suspend background timers, so this is best-effort and does not guarantee continuous backend availability. Handle cold-start delays and temporary unavailability gracefully. The ping must not create persistent user records or store contact data.


## Backend cold-start UI and retries

If Render is waking from sleep and does not respond immediately:

- Keep the rest of the app usable; do not block the whole interface.
- Show a status such as `Connecting to server`.
- Allow for cold-start delays of tens of seconds; do not treat the first timeout or temporary failure as permanent.
- Retry transient failures automatically using bounded retries and backoff, not rapid repeated requests.
- On success, update the status and continue the still-valid operation.
- If retries are exhausted, show a temporary-unavailability message and allow another attempt.

Do not display the backend as ready until a successful response is received.


## Calls when Render is unavailable

Do not block or cancel a call solely because the Render backend is unavailable. Render is used for OneSignal push delivery; ntfy signaling and WebRTC audio are separate paths. Continue the call through ntfy/WebRTC where available, while showing a non-blocking warning that the push notification could not be sent and the recipient may not see an incoming-call alert while the app is inactive. Do not claim the recipient was notified without confirmation. The caller may continue waiting for the normal ntfy response or cancel the call.

## OneSignal unavailable while Render is available

Agreed behavior:

- If OneSignal is temporarily unavailable or returns a transient error, Render makes a bounded number of retries with short delays/backoff; never retry indefinitely.
- If retries fail, return a push-submission failure so the frontend can show a non-blocking warning.
- The call itself continues through ntfy signaling and WebRTC where available. Push failure must not block or cancel it.
- Do not say the recipient was notified unless OneSignal confirms acceptance. API acceptance does not guarantee that the notification was displayed on the device.
- The caller can keep waiting for the normal ntfy response or cancel the call.
- Exact retry count and delay values remain implementation details to be selected during implementation.

## Push delivery acknowledgment — deferred

Decision: Do not implement a separate end-device delivery acknowledgment/confirmation mechanism for push notifications for now. A successful OneSignal API response means the push submission was accepted; it does not prove the recipient's device received or displayed the notification. Keep the call flow independent: ntfy signaling and WebRTC continue to handle signaling and audio.

## OneSignal retry error classification

Decision:
- Retry transient OneSignal failures, including HTTP 429 and HTTP 5xx, subject to the already agreed bounded retry policy.
- Do not retry permanent client/request errors such as HTTP 400, including an invalid or malformed Subscription ID/request.
- Never retry indefinitely.
- If push submission ultimately fails, show a non-blocking warning; the ntfy/WebRTC call continues independently.
- Exact retry count and delay values remain implementation details for a later decision.

## OneSignal HTTP 401/403 handling

Decision:
- HTTP 401 and HTTP 403 from OneSignal are non-retryable configuration/authorization errors.
- Do not automatically retry these responses.
- Keep diagnostic details in backend logs only; never expose API keys or secrets to the frontend.
- Return a generic push-configuration failure for a non-blocking frontend warning.
- Do not interrupt the call; ntfy signaling and WebRTC continue independently where available.

## OneSignal error logging — privacy limits

Decision: Keep only minimal technical diagnostics for OneSignal push failures: timestamp, HTTP status code (if available), event type (incoming_call, call_cancelled, call_ignored), and a coarse internal error category.

Never log push payloads or notification contents, API keys, authorization headers, private keys, Subscription IDs, user_id values, or other user/contact identifiers. Do not expose secrets or raw sensitive provider responses to the frontend. Logs are for troubleshooting only and must not become a user-data store.

## Backend log retention

Decision: Use Render's standard log retention for the deployed service/plan. Do not build a separate persistent log store, database table, or custom log archive. The agreed restrictions on logged fields and sensitive data apply throughout Render's retention period.

## Push request idempotency

Decision: Use (call_id, event type) as the idempotency key. Reprocessing the same logical event for the same call must not send a duplicate push. Deduplication state is temporary/in-memory only; do not add persistent storage or a database for it. The retention window and implementation details will be decided during implementation.

## Different events with the same call_id

Decision: Because the idempotency key is (call_id, event type), different event types for one call are separate events and must not suppress one another. For example, allow incoming_call and then call_cancelled for the same call_id, so cancellation can be delivered. Deduplicate only repeated submissions of the same event type for the same call_id. Backend event validity/call-state validation remains a separate concern.

## Call ID generation and lifetime

Decision: Generate a new cryptographically random UUID for every newly initiated call. Reuse that call_id for all events belonging to that call (incoming_call, call_cancelled, call_ignored, etc.). A new call gets a new UUID, even if it is to the same contact. call_id identifies only a call instance, not a persistent user identity.

## Incoming call timeout and Render wake-up

Decision:
- For the normal path, start the 60-second incoming-call response window only after Render successfully responds to the wake-up/request; do not count Render cold-start time against the recipient's response window.
- Start ntfy signaling and WebRTC in parallel with the Render wake-up request; neither waits for Render.
- If Render remains unavailable, continue through ntfy/WebRTC without waiting for it and use a separate response timeout for this path.
- The duration of the separate timeout when Render is unavailable remains undecided.

## Render-unavailable call response timeout

Decision: If Render does not become available, use a separate 60-second response timeout measured from the moment the caller presses the call button. This is distinct from the normal-path 60-second response window, which starts only after Render successfully responds to the wake-up request.

## Automatic call termination after 60-second timeout

Decision: If the applicable 60-second response timeout expires without an answer:
- send call_cancelled through ntfy;
- if Render is available, also submit call_cancelled through Render/OneSignal;
- show "No answer" to the caller;
- release call-related resources.

The call ends locally regardless of push success. Push delivery is best-effort; ntfy is the primary cancellation signaling path.

## Call timeout race condition

The call lifecycle uses a first-terminal-event-wins rule. The recipient's answer is accepted only if it is processed before timeout/cancellation is committed. Once the caller's timeout has been committed and the call cancellation has been issued, any late answer is ignored. A completed or cancelled call cannot be reopened; a new call requires a new call_id.

## Recipient incoming-call UI timeout behavior

When the incoming-call response window expires, the recipient's incoming-call UI is automatically closed. The recipient sees a local message such as "Call ended — no answer". This is a UI consequence of the already-processed call timeout/cancellation; it does not generate an additional call event.

## Delayed incoming-call notification handling

Before displaying an incoming-call UI triggered by a delayed push/notification, the client must validate the current call state for that call_id. If the call has already been cancelled or expired, the incoming-call UI must not be shown. The implementation must use the existing call/signaling architecture and must not assume that the stateless Render backend stores persistent call state; the concrete status-check mechanism remains to be specified.

## Deferred edge-case policy

To keep development focused on delivering a working application, complex edge cases and unresolved exceptional flows should be documented as deferred work rather than fully designed before the core flow is implemented. The primary happy path takes priority. Deferred items must remain visible in the architecture/checkpoint documentation and be revisited before release or when implementation makes them necessary.

For delayed incoming-call notifications specifically, the detailed current-call-state verification mechanism is deferred. Do not expand the current implementation scope to solve this edge case now; retain the note for later review. Basic expiration handling using the existing expires_at value may be implemented where already supported, without introducing new persistent call-state storage or a new status service.

## Accepted response stops incoming-call timer

When the caller receives the recipient's `accepted` confirmation through ntfy, the 60-second incoming-call response timer stops immediately. WebRTC connection establishment is a separate subsequent stage with its own error handling; the response timer must not continue running during WebRTC setup.

## WebRTC connection setup failure

If WebRTC connection establishment fails after the recipient has accepted the call, both users are shown a clear failure message such as "Could not establish connection". The call is terminated and its resources are released. The exact WebRTC setup timeout and the signaling detail for notifying the peer of setup failure remain to be decided during the core implementation; do not add a new push event solely for this case without a separate decision.
