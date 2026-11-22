# VoiceLink transport research catalogue

Started: 2026-11-22. Research only; this catalogue does not authorize changes to the production VoiceLink application.

## Navigation
- [Evaluation criteria and evidence levels](criteria.md)
- [Candidate register](candidates.md)
- [Cloudflare Workers, public relays and SFU testbeds](cloudflare-workers.md)
- [Candidate record template](candidate-template.md)
- [Earlier public stream / relay research (Stage A)](../public-stream-transports-stage-a.md)

## Research tracks
| Track | Scope | Critical distinction |
|---|---|---|
| Server-side audio/video | TURN relay, SFU, media servers, hosted WebRTC | Media must actually traverse provider infrastructure; signalling-only/P2P is not enough |
| Image delivery | Chat image attachments, image APIs, object storage, image streaming | Can receiver fetch bytes while sender is still uploading? |
| Arbitrary file/data | Binary objects, multipart/chunked/resumable uploads, streaming reads | Chunked upload is not automatically early-readable |
| Messaging/mailbox | WebSocket brokers, pub/sub, event history, inboxes | Separate live delivery from durable retrieval |
| Chat products/SDKs | Hosted chat, support widgets, in-app messaging and voice SDKs | Both testbeds and clues to underlying infrastructure |

## Operating rules
1. Do not change the production VoiceLink app or deployment during this research.
2. Do not create a diagnostic page unless separately requested.
3. Never test in strangers' active support conversations. Prefer a self-owned sandbox, workspace, bot, widget or test project. Public demos may be inspected passively and used only when permitted.
4. Record owner setup separately from caller setup. Owner account may be acceptable; caller registration is a separate constraint.
5. Never expose provider secrets in GitHub Pages JavaScript. Public client keys are acceptable only when documented as client-safe.
6. A WebRTC feature is not proof of server-side media. Verify P2P vs TURN vs SFU/provider relay.
7. Chunked/resumable upload is not proof that another client can read bytes before finalization.
8. Images are first-class candidates. A platform that allows images but blocks arbitrary files remains in scope.
9. Preserve failures and unknowns. Not documented, not tested and browser failure are distinct states.
10. Use synthetic content only; no personal images, customer data or credentials.

## Evidence policy
Every material claim should have a source URL and evidence label. Keep docs separate from observed behaviour. For browser-origin tests record exact origin, browser/runtime, HTTP/WebSocket result and CORS/preflight. For cross-client tests record independent clients, payload and hash result.

The candidate register is an initial inventory, not a claim that every entry has been revalidated today. Update records rather than creating unstructured notes.