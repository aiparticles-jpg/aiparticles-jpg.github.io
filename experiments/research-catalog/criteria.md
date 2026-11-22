# Evaluation criteria and evidence model

## 1. Owner setup vs caller setup
Record owner account/email/phone verification, workspace/project, billing card, domain verification and widget setup separately from caller registration. Also record credential placement (public client key, short-lived token, server-only secret, cookie/session, bearer capability) and backend dependency (none, static public config, token-minting backend, full backend). Priority goes to one-time owner provisioning with anonymous browser callers. Never expose developer secrets.

## 2. Server-side media transport
Classify actual media route:
- SIGNALLING_ONLY: provider exchanges SDP/ICE/room metadata; media is direct.
- P2P: media flows directly between endpoints.
- TURN_RELAY: packets traverse TURN. Record provider, UDP/TCP/TLS, relay-only forcing and free-tier availability.
- SFU: clients publish media to a server which forwards tracks.
- MCU/MIXER: server receives and mixes/transcodes.
- SERVER_STREAM: provider receives and distributes audio/data through another streaming protocol.
- UNKNOWN: route not established.

Record provider/media hostnames, evidence (docs, SDK code, ICE candidate stats, endpoint/packet observation), free quotas, bandwidth/egress, participant minutes, concurrency, bitrate, browser support, token requirements, fallback and encryption. A WebRTC call is not proof of server media. TURN is not SFU.

## 3. Image transport
Images are a separate feature even if arbitrary files are forbidden. Record accepted formats/MIME types, size/dimension/count limits, upload protocol, transformations (resize/transcode/metadata stripping/scanning/thumbnail), message notification timing, image URL availability, early-read behaviour, HTTP Range/partial response, progressive decode, authorization/cookies/CORS, URL expiry and whether the URL is a bearer capability.

Best case: receiver can consume the already-uploaded prefix while sender continues writing. Prove with two independent clients. An ordinary preview or chunked upload is insufficient.

## 4. Arbitrary file and binary transport
Record accepted types, max size, single/multipart/chunked/append/resumable/streaming upload, partial visibility before finalization, GET/Range/streaming/WebSocket read, consistency, overwrite/append semantics, TTL, delete, quotas, CORS/preflight, anonymous access, integrity/order/retry behaviour.

## 5. Messaging, mailbox and realtime
Record WebSocket/SSE/MQTT/WebRTC DataChannel/long polling/push; durable history and retention; delivery semantics and ack/retry; payload/rate/connection/topic caps; binary vs base64/JSON; namespace isolation; independent-client exchange; CORS and auth.

## 6. Chat products and SDKs
Record owner sandbox setup, visitor registration, self-owned widget/inbox/bot, text/history, image attachments and early-read, arbitrary files, audio messages (record/upload/playback), live calls, actual media route, SDK endpoints/third-party infrastructure, public demo permissions and free-tier caps. A chat is not rejected merely because it is unsuitable for production: it may be a testbed or reveal underlying infrastructure.

## 7. Browser and network validation
For browser tests record origin (initial target: https://aiparticles-jpg.github.io), browser/version, method/host/headers/body, OPTIONS/preflight and CORS, cookies/auth, status/response/error, TLS/WSS, payload/hash, date and test commit/run. For cross-client proof record independent A/B clients, discovery mechanism, bytes/hash, read-before-upload-complete and cleanup. GitHub browser runner success does not prove Android Chrome/Firefox on Turkish mobile networks.

## 8. Evidence levels (per capability)
- E0 Lead/marketing claim.
- E1 Official docs/pricing/source code.
- E2 Server-side API/SDK test.
- E3 Browser-origin test including CORS/preflight.
- E4 Independent clients exchange and verify content/integrity.
- E5 Early-read proof or proof media traverses provider relay when P2P is disabled/blocked.
A provider may be E4 for chat text and only E1 for media relay.

## 9. Verdict vocabulary
PASS; CONDITIONAL; RESEARCH_ONLY; FAIL_BROWSER; FAIL_CAPABILITY; UNKNOWN; DEFERRED. Never turn unknown into pass/fail. Include exact date and observation.

## 10. Capability vector (avoid one opaque score)
- server_media: none / TURN / SFU / mixer / server stream / unknown
- image_transfer: none / ordinary / early-readable / streaming / unknown
- file_transfer: none / ordinary / chunked / early-readable / streaming / unknown
- caller_access: anonymous / invite-token / account / unknown
- browser_status: E0-E5 per capability
- free_tier: yes / limited / no / unknown
- backend_need: none / public config / token backend / full backend / unknown
- overall_priority: P0 / P1 / P2 / P3 / rejected

Priority reflects VoiceLink constraints, not vendor marketing.