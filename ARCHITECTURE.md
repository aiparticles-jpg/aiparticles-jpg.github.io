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

A locally saved contact contains:

- `name`: local display name / alias;
- `user_id`: public-key fingerprint;
- `public_key`;
- `push_subscription_id`: OneSignal Subscription ID.

The contact list is stored only in the browser. Render does not store contacts or a mapping between `user_id` and OneSignal Subscription ID.

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
- only the three explicitly allowed event types;
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

The sender's display name is resolved locally from the recipient's address book. Do not send names, SDP, audio, private keys, or other sensitive data through OneSignal.

Tapping a push opens the app; the app then continues signaling through ntfy.

## 8. When push notifications are sent

Agreed behavior:

1. When an outgoing call starts, send `incoming_call` through Render/OneSignal at the same time as starting the call through ntfy.
2. When the caller cancels the call, send `call_cancelled`.
3. When the recipient explicitly rejects the call, send `call_ignored`.
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

This is an agreed architecture decision, not an implemented or compatibility-tested feature. Browser support and IndexedDB structured-clone behavior for non-extractable `CryptoKey` objects must be verified during implementation.

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

IndexedDB is the agreed local storage mechanism for the application's identity and address book. The application uses IndexedDB for:

- The non-extractable private `CryptoKey` object.
- The public key and derived `user_id`.
- Contact records, including each contact's locally assigned name, `user_id`, public key, and OneSignal Subscription ID.
- Contact trust and SAS-verification status.

These data remain on the user's device. They are not synchronized to cloud storage or stored as a persistent address book on the backend. `localStorage` is not used for identity or contact data.
