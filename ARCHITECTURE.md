# Voicelink — Architecture Decisions

This document records decisions explicitly agreed during project discussions. It is a living architecture log, not a claim that every item has already been implemented.

Repository: `aiparticles-jpg/aiparticles-jpg.github.io`  
Frontend: GitHub Pages  
Status: architecture agreed in part; implementation of the decisions below is not yet confirmed.

## 1. Product principles

- The application is anonymous. Usernames are not transmitted as network identities.
- A contact name is a local alias chosen by the person who saves that contact. It remains in that browser and is never sent to the other person or to the backend.
- No database or persistent server-side address book is planned.
- Agree architecture first; implement only after the relevant decisions have been discussed and confirmed.

## 2. Anonymous identity and cryptographic keys

- Do not create a separate random UUID for the user identity.
- Generate an ECDSA P-256 key pair on first use.
- The public identity, `user_id`, is the SHA-256 fingerprint of the public key.
- The private key stays in the browser and is never shared.
- The public key may be shared with contacts.
- Derive the `user_id` from the saved public key when the application loads.
- Existing code in `js/ntfy-signaling.js` has ECDSA P-256/JWK and localStorage logic, but its current key storage is tied to a username and needs redesign for anonymous identity.
- Security item to address during implementation: the existing private key is exported as JWK and stored in localStorage in readable form. Do not treat that as a finalized secure-storage design.

## 3. Local contacts

Contacts are stored locally in the IndexedDB `contacts` object store. The application supports importing signed contact packages, listing contacts, updating trust after SAS verification, and deleting a contact.

A locally saved contact contains:

- `name`: local display name / alias;
- `user_id`: public-key fingerprint;
- `public_key`;
- `push_subscription_id`: OneSignal Subscription ID.

The contact list is stored only in the browser. Render does not store contacts or a mapping between `user_id` and OneSignal Subscription ID.

Contact deletion removes the complete contact record, including its public key, OneSignal Subscription ID, and trust/verification state. Local call-history entries are retained and contain no cryptographic keys or push identifiers. To reconnect after deletion or key rotation, import a newly shared signed URL/QR package.

## 4. Contact exchange: QR code and URL

Both methods are supported and carry the same contact package:

- `user_id`;
- `public_key`;
- `push_subscription_id`;
- signature.

The private key is never included.

The URL format uses the URL fragment (after `#`), for example:

```
https://aiparticles-jpg.github.io/#contact=...
```

The browser loads the static page normally; the fragment is not sent in the HTTP request to GitHub Pages. Frontend JavaScript reads `window.location.hash`, decodes the package and validates it locally.

Import flow:

1. Scan the QR code or open the contact URL.
2. Validate the package, including the public-key fingerprint.
3. Ask the user to enter a local contact name.
4. Save the contact with status **Unconfirmed**.
5. On the first connection, compare the SAS (short authentication string). After successful confirmation, mark the contact as trusted.

The contact package is signed with the owner's ECDSA P-256 private key. The signature covers all important package fields: `user_id`, `public_key`, `push_subscription_id`, and `version`.

The signature proves package integrity and possession of the corresponding private key. It does not prove a real-world person's identity; trust is established through SAS verification.

If the owner's OneSignal Subscription ID changes, the owner creates and shares an updated contact package again. The QR code and URL both include the current Subscription ID.

## 5. Component responsibilities

- **OneSignal** — push notifications, including when the app is in the background.
- **ntfy** — existing signaling channel for call events (call, answer, cancellation) and WebRTC signaling exchange.
- **WebRTC** — direct audio transport between peers.
- **Render** — stateless HTTP backend that validates signed requests and sends push notifications through OneSignal.

Cloudflare Workers are not part of the selected architecture. The project discussion identified connectivity problems with the free `workers.dev` address in the user's network environment; a paid custom domain is not an option for this project.

Render is expected to use a secret stored in environment variables. The OneSignal secret must never be exposed in frontend code.

No database or persistent user-data storage is planned on Render. Render Free Web Services may sleep after inactivity and have cold-start delays; this must be considered in the implementation.

## 6. Backend request protection

The agreed baseline protection for the public Render endpoint is:

- ECDSA P-256 signatures;
- SHA-256 validation of `user_id` against the supplied public key;
- timestamp validation with a 60-second acceptance window;
- a random nonce per request;
- rate limiting;
- only the explicitly allowed event types: `incoming_call`, `call_cancelled`, `call_ignored`, and `call_ended`;
- no arbitrary message text or arbitrary OneSignal parameters from the client;
- no persistent storage of user data.

A valid signature proves possession of a key, not that the caller is a legitimate or unique human user. Anyone can generate their own key pair and sign requests with it.

To retain replay/rate-limit state without a database, the agreed approach is temporary in-memory state in the Render process:

- used nonces;
- request counters by IP;
- request counters by `user_id`.

The initial example values discussed were nonce retention for 2 minutes, 10 requests/minute per IP, and 5 requests/minute per `user_id`. These numbers were examples, not separately finalized limits.

Important limitations: in-memory state is lost on restart and is not shared across multiple service instances. It is a basic abuse/replay mitigation, not strong distributed rate limiting or an absolute replay guarantee.

## 7. Push payload and allowed events

Push notifications carry only minimal metadata. The agreed example for an incoming call is:

```json
{
  "event": "incoming_call",
  "sender_id": "SHA256(public_key)",
  "call_id": "...",
  "expires_at": 1790000000
}
```

Only these event types are allowed:

- `incoming_call`
- `call_cancelled`
- `call_ignored`
- `call_ended`

The sender's display name is resolved locally from the recipient's address book. Do not send names, SDP, audio, private keys, or other sensitive data through OneSignal.

Tapping a push opens the app; the app then continues signaling through ntfy.

## 8. When push notifications are sent

Agreed behavior:

1. When an outgoing call starts, send `incoming_call` through Render/OneSignal at the same time as starting the call through ntfy.
2. When the caller cancels the call, send `call_cancelled`.
3. When the recipient explicitly rejects the call, send `call_ignored`.
4. When either participant explicitly ends an established call, send `call_ended` through ntfy and submit the corresponding push event through Render/OneSignal when available; the peer terminates the call and releases its resources.
4. No separate push is needed when the recipient answers; the answer arrives through ntfy.
5. Merely hiding/dismissing the incoming-call screen is not rejection and must not send `call_ignored`. The caller continues waiting.

## 9. Incoming-call controls — latest agreed decision

The incoming-call UI will have three distinct actions:

| Action | Behavior |
|---|---|
| **Answer** | Accept the call. |
| **Reject** | Explicitly reject the call; send `call_ignored` through Render/OneSignal and ntfy. The caller stops waiting for an answer. |
| **Hide** | Dismiss the incoming-call UI locally only. Do not notify the caller; the caller continues waiting. |

The user explicitly approved adding a separate **Reject** button. This is an architectural decision; the code change has not yet been made or verified.

## 10. Implementation status and open items

- This document records agreed design decisions; it does not mean the implementation is complete.
- The separate **Reject** button and its event handling are approved but not yet implemented/verified.
- The exact rate-limit numbers remain to be finalized.
- Private-key storage needs a deliberate security design before implementation.
- Existing frontend/signaling code must be inspected before making code changes so the implementation matches the actual repository.

## 11. Private-key storage in the browser

The user explicitly approved the following browser-side private-key storage design:

- Generate the ECDSA P-256 private key using the Web Crypto API with `extractable: false` (non-extractable).
- Store the resulting `CryptoKey` object in IndexedDB.
- Do not export private-key material to JWK and do not store it in `localStorage`.
- Use the stored `CryptoKey` directly for signing contact packages and authenticated backend requests.
- The public key remains exportable and may be shared with contacts.

Implemented as the first storage foundation in `js/local-store.js`: the module creates the local IndexedDB stores and generates/loads the ECDSA P-256 identity with a non-extractable private `CryptoKey`. The public key is exported in raw form and `user_id` is its SHA-256 fingerprint. Browser compatibility and end-to-end integration with contact exchange/signaling still need to be tested.

Open consequence to resolve before implementation: clearing browser data, reinstalling the browser, or moving to another device may destroy access to the private key and therefore the existing identity. Recovery or backup would require a separately agreed security design; do not silently introduce private-key export or cloud backup.

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

- The frontend checks IndexedDB for the locally stored non-extractable private key.
- If the key exists, the application loads and uses the existing cryptographic identity.
- If the key is absent, the application generates a new ECDSA P-256 key pair and derives a new `user_id` from the new public key.
- Locally stored contacts are retained and used if they are still present.
- If browser data has also been cleared and the local address book is absent, the user must add contacts again by importing their contact packages.

Identity and the contact list are not synchronized to cloud storage or the backend. No cloud backup or cross-device synchronization is included in the agreed architecture.


## Local storage for identity and contacts

Implemented foundation: `js/local-store.js` creates the `meta`, `contacts`, and `history` object stores and exposes local identity, contact, and call-history operations. This is a data-layer implementation only; the existing legacy UI/signaling flow has not yet been migrated to use it.

IndexedDB is the agreed local storage mechanism for the application's identity and address book. The application uses IndexedDB for:

- The non-extractable private `CryptoKey` object.
- The public key and derived `user_id`.
- Contact records, including each contact's locally assigned name, `user_id`, public key, and OneSignal Subscription ID.
- Contact trust and SAS-verification status.

These data remain on the user's device. They are not synchronized to cloud storage or stored as a persistent address book on the backend. `localStorage` is not used for identity or contact data.


## Local contact-data encryption

Contact records in IndexedDB are stored without additional application-level encryption. This keeps local contact storage simple. The private key remains a non-extractable Web Crypto `CryptoKey` stored in IndexedDB, as specified in the private-key storage section. This decision does not claim that IndexedDB itself encrypts contact data.


## Contacts with an inactive OneSignal Subscription ID

Do not automatically delete a contact when its OneSignal Subscription ID becomes inactive, invalid, or stops receiving push notifications. Preserve the contact record and its locally assigned name. When the contact's current push details are available again, allow the user to update the contact package through QR code or URL exchange and verify the updated identity/contact data as required. An inactive Subscription ID must not by itself cause the contact or its trust record to be deleted.


## Updating the user's OneSignal Subscription ID

When OneSignal assigns the current user a new Subscription ID:

- Update the user's own locally stored Subscription ID in IndexedDB.
- Generate an updated contact package containing the current `user_id`, public key, new `push_subscription_id`, version, and signature.
- Make the updated package available for the user to share with contacts through the existing QR-code or URL mechanism.
- Do not automatically delete or rewrite existing contacts on other users' devices; they must receive and import the updated package to refresh the stored Subscription ID.
- The cryptographic identity does not change solely because the OneSignal Subscription ID changes. The updated package must be signed with the existing private key.


## Browser notification permission denied

If the user denies or blocks browser notification permission:

- Show a clear in-app warning explaining that push notifications are unavailable and incoming-call alerts may not arrive while the application is not active.
- Offer guidance to enable notifications in the browser's site settings.
- Do not repeatedly trigger the browser permission prompt or attempt to bypass the user's choice.
- Keep the rest of the application usable where technically possible; denying push permission must not by itself block use of Voicelink.


## Notification permission request timing

Do not request browser notification permission automatically on the first page load. First explain why Voicelink needs notifications and show an explicit `Enable notifications` button. Request browser permission only after the user presses that button. If permission is denied or blocked, follow the behavior defined in the browser notification permission section.

## Render backend wake-up and keep-alive requests

The Render backend may enter sleep after a period of inactivity (approximately 15 minutes on the current hosting plan). The frontend therefore uses the following best-effort wake-up strategy:

- Send a lightweight request to the backend when the web application starts, so a sleeping backend can wake up.
- While the application remains active, send a lightweight ping approximately every 14 minutes.
- Stop the periodic ping when the application is closed or no longer running.
- When the user returns to the application after a period away, send a new request immediately rather than relying on a timer that may have been suspended.

Browser and mobile operating systems may throttle or suspend timers in background tabs or sleeping devices. Therefore, the 14-minute interval is best-effort and cannot guarantee that the backend remains awake continuously. The frontend must handle delayed responses, cold starts, and temporary unavailability gracefully. These pings are for backend availability only; they do not create persistent user records or store contact data.


## Backend cold-start UI and retry behavior

When a frontend request wakes a sleeping Render backend and the backend is not immediately available:

- Keep the main application interface usable; do not block the entire UI while the backend starts.
- Show a clear status such as `Connecting to server` while the backend is starting or the request is pending.
- Handle cold-start delays (which may take tens of seconds) without treating the first timeout or temporary failure as a permanent error.
- Retry transient failures automatically with a bounded retry strategy and reasonable backoff; avoid rapid repeated requests.
- When the backend responds successfully, update the connection status and continue the operation that required the backend where it is still valid.
- If retries are exhausted, show a clear temporary-unavailability message and allow a later retry.

The frontend must not claim the backend is ready until it receives a successful response.


## Calling while the Render backend is unavailable

Render is used to send OneSignal push notifications; it is not the audio transport or the ntfy signaling channel. If Render is unavailable when a user starts a call:

- Do not block or cancel the call solely because Render is unavailable.
- Continue the call flow through ntfy and WebRTC where those services and the peer connection are available.
- Show a non-blocking warning that the push notification could not be sent and the recipient may not receive an incoming-call alert while Voicelink is inactive.
- Do not claim that the recipient was notified unless the relevant service confirms success.
- The caller can continue waiting for the normal ntfy call response or cancel the call.

This preserves the distinction between the independent signaling/audio path and the optional push-notification path.

## OneSignal unavailability and push retry behavior

If the Render backend is available but the OneSignal service/API is temporarily unavailable or rejects the push request due to a transient service error:

- Render should make a small, bounded number of retry attempts with short delays/backoff.
- Do not retry indefinitely or create a rapid request loop.
- If push submission still fails, report the push failure to the frontend so it can show a non-blocking warning.
- Do not block, cancel, or otherwise interrupt the call because push delivery failed. Continue the independent ntfy signaling and WebRTC call flow where available.
- Do not claim that the recipient was notified when OneSignal has not confirmed acceptance of the push request. A successful API response confirms submission/acceptance, not necessarily display on the recipient's device.
- The caller may continue waiting for the normal ntfy response or cancel the call.

The exact retry count and delay values are implementation parameters and are not fixed by this architectural decision.

## Push delivery confirmation

Do not add a separate end-device delivery acknowledgment or delivery-confirmation mechanism for push notifications at this stage. Treat a successful OneSignal API response only as acceptance of the push submission, not proof that the recipient's device received or displayed it. The call flow must continue to rely on ntfy signaling and WebRTC independently of push delivery.

## OneSignal retry classification

Retry push submission only for transient OneSignal failures, including HTTP 429 (rate limiting) and HTTP 5xx responses, using the bounded retry policy defined for push submission. Do not retry permanent client/request errors such as HTTP 400 (for example, an invalid or malformed Subscription ID/request). Do not retry indefinitely. Surface a non-blocking push failure to the frontend if the bounded attempts fail; do not interrupt the independent ntfy/WebRTC call flow.

## OneSignal authentication and authorization errors

Treat OneSignal HTTP 401 and HTTP 403 responses as non-retryable configuration/authorization errors. Do not automatically retry these responses. Record a server-side diagnostic suitable for the operator, without exposing the OneSignal API key or other secrets to the frontend. Return a generic push-configuration failure to the frontend so it can show a non-blocking warning. The call must continue through ntfy and WebRTC where available.

## OneSignal error logging and privacy

For OneSignal push failures, backend logs may contain only minimal technical diagnostics:
- timestamp;
- HTTP status code, when available;
- event type (`incoming_call`, `call_cancelled`, `call_ignored`, or `call_ended`);
- a coarse internal error category.

Do not log push payloads, notification contents, API keys, authorization headers, private keys, Subscription IDs, user_id values, or other contact/user identifiers. Do not expose secrets or raw sensitive provider responses to the frontend. Logging is for troubleshooting only and must not become a user-data store.

## Retention of backend technical logs

Use the standard log retention provided by Render for the deployed service and plan. Do not create a separate persistent log store, database table, or custom archive for these technical logs. The privacy limits defined above continue to apply for the entire period in which Render retains the logs.

## Push request idempotency

Use the combination of call_id and event type as the idempotency key for push submission. Reprocessing the same logical event for the same call must not create a duplicate push notification. Keep any deduplication state temporary and in memory, consistent with the stateless backend design; do not introduce a persistent database or user-data store for this purpose. The deduplication retention window and exact implementation details remain to be selected during implementation.

## Idempotency across different call events

The idempotency key includes both call_id and event type. Therefore, different allowed event types for the same call_id are distinct logical events and must not be deduplicated against one another. For example, incoming_call followed by call_cancelled must allow both push submissions, so the cancellation can reach the recipient. Only a repeat of the same event type for the same call_id is a duplicate. Event validity and call-state rules remain separately enforced by the backend.

## Call ID generation and lifetime

Generate a new cryptographically random UUID for every newly initiated call. All events belonging to that call (such as incoming_call, call_cancelled, call_ignored, and call_ended) must use the same call_id. A later call, including a retry initiated as a new call, receives a new call_id. The call_id identifies a call instance; it is not a persistent user identity.

## Incoming call timeout and Render wake-up timing

The 60-second incoming-call response window starts only after the Render backend has successfully responded to the wake-up/request. It must not be counted while Render is still waking from sleep. Start the ntfy signaling and WebRTC call flow in parallel with the Render wake-up request; do not make them wait for Render.

If Render does not become available, do not wait for it before proceeding with ntfy/WebRTC. Use a separate call-response timeout for this Render-unavailable path. The duration of that separate timeout is not yet decided.

## Call response timeout when Render is unavailable

If Render does not become available for the call, use a separate 60-second response timeout measured from the caller pressing the call button. This timeout applies to the Render-unavailable path; it is independent of the normal 60-second response window that starts after a successful Render wake-up response.

## Automatic call termination after response timeout

When the applicable 60-second caller response timeout expires without an answer, automatically terminate the outgoing call:
- send call_cancelled through ntfy;
- if the Render backend is available, also submit call_cancelled for push notification through Render/OneSignal;
- show the caller a "No answer" status;
- release call-related resources.

The call must be treated as ended locally even if the optional push submission fails. The ntfy cancellation is the primary signaling action; push remains best-effort.

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

## WebRTC connection setup timeout

After the recipient accepts the call, WebRTC has up to 30 seconds to establish the connection. If the connection is not established within 30 seconds, the call is terminated, both users are shown a connection-failure message, and call resources are released.

## WebRTC connection status

While WebRTC is being established, both users see the status "Connecting…". Once the WebRTC connection is successfully established, the status changes to "Connected".

## Established WebRTC connection loss

If an established WebRTC connection is unexpectedly lost, the call is automatically terminated, call resources are released, and both users are shown the message "Connection lost".

## Post-call navigation

After a call ends for any reason, both participants return to the application's main screen. The application does not automatically initiate another call.

## Post-call result messages

After a call ends, show a brief result message explaining the reason:
- "Call ended"
- "No answer"
- "Connection lost"
- "Could not establish connection"
- "Call rejected"

The message is displayed after returning to the main screen and disappears automatically after 3 seconds.


## Local call history

The main screen will show the 10 most recent call attempts. Record every call attempt, including answered calls, missed/unanswered calls, rejected calls, and calls cancelled by the caller. Each attempt is a separate history entry, even when the same contact calls repeatedly. Each entry records the locally resolved contact name/alias, date, time, and outcome.

- Store call history only in the browser's IndexedDB.
- Do not send call-history records, contact aliases/names, or history identifiers to Render, OneSignal, ntfy, or any other server.
- This is a local activity list, not a server-side call log.
- The exact UI presentation and any additional history-management actions remain to be decided during implementation.
- MVP scope rule: prioritize only essential functionality needed for a simple working app. Minor details, edge cases, and non-essential enhancements should be noted as deferred items rather than blocking progress; decide on them later.


### Call-history deletion

The user may clear the entire local call history. Individual call-history entries cannot be deleted separately. The history remains local in IndexedDB; clearing it removes the complete local call-history list. Before clearing, show a warning/confirmation dialog. Delete the complete history from IndexedDB only after the user explicitly confirms.

- After the history is cleared, simply show the history list with no entries; do not add a separate empty-state message.


## Invitation creation requires push permission

The single “Поделиться приглашением” action also represents the user's consent to receive incoming-call push notifications. A signed invitation is created only after browser notification permission is granted and OneSignal provides a non-empty Subscription ID. If the user denies the permission, no new invitation is created. If permission is already denied, the app does not repeatedly request it; it directs the user to the browser's site settings. Existing invitation package fields and signature format remain unchanged.


## Contact request reply flow — 2026-11-07

- Bob imports Alice's signed invitation, selects her contact, and presses “Ответить на приглашение”.
- The action obtains Bob's current OneSignal Subscription ID (requesting browser permission if needed), builds the existing v1 signed contact package, and wraps it in a second ECDSA-signed `contact_request` envelope addressed to Alice's anonymous user ID.
- The signed request envelope is published to Alice's existing ntfy topic. The package contains only Bob's public key, anonymous user ID, OneSignal Subscription ID, and signature; it is not an encrypted message. The signature and recipient binding protect authenticity and integrity. The ntfy topic is derived from Alice's public ID and is not treated as a confidentiality boundary.
- After ntfy accepts the message, the frontend submits a `contact_request` event to the existing Render `/v1/push` endpoint. Render sends a OneSignal notification: “Пользователь хочет добавить вас в контакты VoiceLink.” The push contains only event metadata; it does not carry the contact package.
- Alice's existing startup ntfy subscription validates the contact package, fingerprint, outer signature, recipient ID, and expiry. The UI shows a pending request and lets Alice enter a local alias and accept or decline it.
- Accepting saves Bob's verified package in Alice's IndexedDB as an untrusted contact. Bob already has Alice saved from importing her invitation. First-call SAS verification remains unchanged.
- Declining removes the request from the local UI only; no decline notification is sent.
- Contact requests expire after two minutes. The existing ntfy subscription replays messages from the last 120 seconds, matching this request lifetime.
- OneSignal is best-effort. If push submission fails after ntfy publication, the request remains published and the sender sees a warning; no contact data is placed in the push payload.
- Browser testing on two independent devices, including delayed push/open behavior, remains required.
