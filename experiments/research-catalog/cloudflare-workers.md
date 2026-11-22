# Cloudflare Workers, public relays and SFU testbeds

Research date: 2026-11-22. This document separates public deployed endpoints from source-only projects that require the user to deploy their own Worker. Evidence is per capability. No production VoiceLink code was changed.

## Executive summary

The strongest current findings are:

1. **Mazupo public Cloudflare SFU** — published device/viewer public keys issue 30-second access tokens. The public Worker accepted requests from the VoiceLink GitHub Pages origin. Two browser clients then exchanged binary DataChannel data in both directions through the SFU, with early receiver delivery confirmed.
2. **Weblink public TURN credential endpoint** — a public Worker issues temporary Cloudflare TURN credentials. Forced relay-only WebRTC successfully carried both a DataChannel message and audio RTP. This is TURN relay, not SFU.
3. **CopyPaesto** — a public Worker and public app implement a file-transfer fallback through WebSocket/ Durable Objects. The source documents streaming 512 KiB frames and receiver writes while the sender continues. Its public health endpoint is reachable from the VoiceLink GitHub Pages origin. Full live file-transfer test is pending.
4. **Cloudflare Realtime SFU itself** — official service supports server-forwarded DataChannels, including binary payloads, and audio/video. Its free egress allowance is 1,000 GB/month shared with TURN. A small Worker backend is required for token minting and session/channel allocation; it does not need to be always running.

## 1. Public deployed services

### 1.1 Mazupo — public Cloudflare Realtime SFU

- Public viewer page: https://api.mazupo.com/sfu/
- Public device simulator: https://api.mazupo.com/sfu/device
- Public app with microphone UI: https://app.mazupo.com/cloudflare
- API endpoint: https://api.mazupo.com/sfu/token
- Source: https://github.com/mazupo/cf-sfu-worker
- Documentation: https://mazupo.com/docs/pi-webrtc/signaling/sfu

**Access model**
- The project publishes separate device and viewer public keys.
- Browser calls `POST /sfu/token` with `Authorization: Bearer <public-key>`.
- Worker signs a short-lived token (30 seconds); signing/private material remains server-side.
- Browser-origin token calls from `https://aiparticles-jpg.github.io` succeeded for both roles.
- Token endpoint returns a WebSocket origin at `wss://api.mazupo.com`.
- No end-user registration was required for the test.
- Public server is shared; room IDs must be random/unpredictable. The Worker source/config documents a token rate limit of 20 requests/minute/IP and room/device/viewer caps.

**Observed browser test**
- Two independent browser pages joined one random room: device simulator and viewer.
- Device used a generated test-pattern video; viewer received a 640×360 video track.
- Reliable DataChannel opened in both directions.
- Viewer took control, receiving the one-subscriber `canReply` permission.
- Sent 256 KiB viewer→device and 256 KiB device→viewer, using 16 KiB binary fragments.
- Byte count and deterministic checksum matched in both directions.
- Receiver got the first 16 KiB while the sender had sent only 16 KiB of 256 KiB. The test deliberately waited for each chunk to arrive before sending the next.
- **Verdict: E5 server-forwarded binary DataChannel + early-read, bidirectional.**

Test run: https://github.com/aiparticles-jpg/aiparticles-jpg.github.io/actions/runs/45023570612

**Capabilities and limitations**
- This is a Cloudflare Realtime SFU path, not direct peer-to-peer.
- DataChannel payloads are binary-capable. The live implementation exposes reliable and lossy channels; reliable ordered is appropriate for file chunks.
- One viewer at a time can receive the reply permission to send back to the device. This is sufficient for a two-party device/viewer topology, but not unrestricted many-to-many symmetric chat.
- Device simulator source uses `getUserMedia({audio:true, video:true})` for camera mode; the viewer app has a microphone/talk UI. Audio is documented, but the public SFU audio RTP path has not yet been separately measured in this test suite.
- No durable mailbox/history for DataChannel payloads; both endpoints must be connected.
- An older Pi WebRTC guide says Cloudflare Realtime DataChannels are not yet supported, but the current Worker repo exposes IPC/DataChannel support and the live binary test passed. Treat the older guide as stale for this deployed Worker.
- Public shared quota and room-name discoverability make this a testbed, not an automatically safe production dependency.

### 1.2 Weblink — public Cloudflare TURN credentials

- Endpoint: https://ws.webl.ink/turn-credentials
- Worker source: https://github.com/99percentpeople/weblink-ws-worker
- Public app: https://webl.ink/

**Access model**
- `POST /turn-credentials` works cross-origin from the VoiceLink GitHub Pages origin.
- OPTIONS preflight returned 204; POST returned 200.
- No API key or user registration required.
- Returns Cloudflare STUN/TURN ICE servers and credentials with a 24-hour expiry.
- Source shows wildcard CORS and no separate rate limiter on this credential endpoint. WebSocket signaling has its own limiter.

**Observed forced-relay test**
- Two independent RTCPeerConnection endpoints in a browser runner used `iceTransportPolicy: "relay"`.
- A DataChannel message was delivered.
- A synthetic audio track was received; inbound audio RTP bytes were nonzero (about 5.9 KiB in the test).
- Both selected ICE candidates were `relay`; selected transport protocol was UDP.
- **Verdict: E5 for TURN-relayed DataChannel and audio RTP in the browser runner.**

Test run: https://github.com/aiparticles-jpg/aiparticles-jpg.github.io/actions/runs/45023106067

**Caveat**
This endpoint uses another project's Cloudflare account and quota. It is a valuable test endpoint and architectural reference, but do not depend on or consume it in VoiceLink production without the maintainer's permission. No SLA or general-purpose third-party usage grant was established. It is TURN relay, not an SFU.

### 1.3 CopyPaesto — public Worker file-relay fallback

- Public app: https://albyaty.github.io/CopyPaesto/
- Public Worker health: https://copypaesto-relay.albyaty.workers.dev/health
- Source: https://github.com/albyaty/CopyPaesto

**Access model**
- No user account is required. Devices pair using a five-digit code; the host explicitly approves each joiner.
- Local device identity and ECDH key exchange are used to establish a temporary session.
- Worker uses Durable Objects for pairing, room state, signaling and file relay.
- Health request from `https://aiparticles-jpg.github.io` returned HTTP 200 and `{"ok":true,"service":"copypaesto-relay"}`.

**File relay design from source/README**
- Tries direct WebRTC DataChannel first; if direct connection is blocked, switches to Worker WebSocket relay.
- Uses 512 KiB binary WebSocket frames, 32 MiB acknowledgement window, 4 MiB browser WebSocket queue and receiver writes batched up to 2 MiB.
- Chrome/Edge can stream incoming files directly to disk. Memory fallback is limited to 128 MiB.
- Room relay state expires after 24 hours.
- Files are not stored as durable objects for later download; both devices must remain online.
- Turbo fallback uses TLS/WSS and exposes bulk file bytes to the Worker/any TLS-inspecting proxy. Clipboard content, filenames, signaling and transfer controls are encrypted in the browser; an older end-to-end encrypted chunk protocol remains in the code.
- No file-type restriction was found; arbitrary files, including image MIME types, are in scope. No special image transcoding or preview pipeline was established.

**Evidence**
- Source-level streaming architecture: E1.
- Public Worker health/CORS reachability from VoiceLink origin: E3.
- Full two-client Worker file relay with early-read: pending the current browser test.
- This is a complete app-specific protocol, not a generic public arbitrary-message API.

### 1.4 YSTP — public WebSocket file relay (not currently verified usable)

- Site: https://ystp.dbk.wtf/
- Source: https://github.com/deathbyknowledge/ystp

Source describes a Worker/Durable Object WebSocket relay that forwards 64 KiB binary chunks directly to the receiver without persistent file storage. The browser UI accumulates chunks in memory and offers the file after EOF, but the underlying messages arrive progressively.

However, the browser test attempted sender/receiver WebSocket sessions both from the VoiceLink origin and from the service's own origin; receiver WebSocket handshake failed in both attempts. **Do not treat the deployed endpoint as currently usable.** Keep the source as an architecture reference; revisit only if the maintainer restores/fixes the live endpoint.

Test run: https://github.com/aiparticles-jpg/aiparticles-jpg.github.io/actions/runs/45023327796

### 1.5 P2PCF — old public Worker endpoint, not a current candidate

- Source: https://github.com/gfodor/p2pcf
- Default URL found in the old install guide: `https://p2pcf.minddrop.workers.dev`.

The source is a signaling service using Worker/R2 polling; media remains P2P or uses a separate TURN service. The old public endpoint failed browser fetch from the VoiceLink origin. **Not a server-media or current public relay pass.**

### 1.6 Other public Cloudflare demos

**Cloudflare Meet / Orange Meets**
- Demo: https://demo.orange.cloudflare.dev/
- Source: https://github.com/cloudflare/meet
- Public demo asks for a display name, not a user account.
- Uses Cloudflare Realtime SFU for audio/video and Durable Objects/PartyServer for room coordination.
- Strong testbed for server-routed calls and inspecting a complete Worker+SFU architecture.
- No general binary file transfer capability established.

**Cloudflare Edge Chat Demo**
- Demo: https://edge-chat-demo.cloudflareworkers.com/
- Source: https://github.com/cloudflare/workers-chat-demo
- Public anonymous room chat built on Durable Objects/WebSockets, with message history.
- Text mailbox/testbed only; no image/file/audio transport established.

## 2. Source-only Cloudflare Worker projects

### 2.1 File Handoff Service (FHS)

- Source: https://github.com/Spuds0588/File-Handoff-Service-FHS-

Open-source Worker + Durable Objects file handoff, designed to be deployed into the user's own Cloudflare account. No shared public backend was found. It accepts binary data and streams upload/download in chunks; default maximum file size is 25 MB and chunks are 8 MiB. Handoff is single-use and expires after completion.

**Important:** the upload writes a layout/seal record last. The receiver cannot retrieve the file until the sender has finished uploading. Thus it supports ordinary server-side file transfer but **not** the desired receiver-reads-before-upload-completes behaviour.

### 2.2 Cloudflare signalling Worker

- Source: https://github.com/gfodor/cloudflare-signalling

Open-source Durable Object/WebSocket signaling relay with optional generic message forwarding and optional TURN credential endpoint. No shared deployed endpoint was identified. Useful if deploying a small Worker ourselves; it is signaling/message relay, not an SFU.

### 2.3 Image-hosting Workers

Several image-hosting projects use Cloudflare Pages/Workers + R2, but write access generally requires an owner credential, Cloudflare Access or a server-side token. One public preview project (roim-picx, https://github.com/roimdev/roim-picx) publishes a preview token that is actually an administrative login token, not a restricted client-safe key. Do not reuse such a shared admin token as a VoiceLink client key.

No clean public anonymous image-upload Worker with a restricted public client key and receiver-visible early-read was confirmed in this pass.

## 3. Cloudflare self-deploy economics (current docs)

### Workers Free
Official pricing: https://developers.cloudflare.com/workers/platform/pricing/
- 100,000 Worker requests/day.
- 10 ms CPU per invocation.
- No duration charge on Workers Free.
- WebSocket upgrade connection counts as a request; WebSocket messages routed through a Worker do not count as Worker requests.
- Workers Free is the default plan; a free `workers.dev` subdomain can be used without owning a domain.

### Durable Objects Free
Official pricing: https://developers.cloudflare.com/durable-objects/platform/pricing/
- Durable Objects are available on Workers Free, but only SQLite-backed DOs.
- 100,000 requests/day and 13,000 GB-s/day.
- Incoming WebSocket messages use a 20:1 ratio for request billing; outgoing messages are not charged as requests.
- WebSocket Hibernation API can avoid duration charges while idle.
- SQLite storage free allowance: 5 million reads/day, 100,000 writes/day, 5 GB total.
- Exceeding a free limit causes further operations of that type to fail; there is no automatic overage on Free.

### Cloudflare Realtime SFU / TURN
Official pricing: https://developers.cloudflare.com/realtime/sfu/platform/pricing/
- First 1,000 GB/month of egress is free, shared by SFU and TURN.
- Additional egress: $0.05/GB.
- This allowance is separate from Workers/DO request limits.

**Practical implication:** a Worker + Durable Object can be a serverless control/signaling plane with no always-on process, while Realtime SFU handles server-forwarded media and DataChannels. App Secret stays in Worker secrets; browser clients receive short-lived tokens. This is a stronger architecture than exposing a shared secret in GitHub Pages.

**Network caveat:** free Workers can use a `workers.dev` hostname without a custom domain, but that hostname has previously timed out on the user's Turkish mobile network. Public custom-domain endpoints tested here are not proof that a self-deployed `workers.dev` endpoint will work in Turkey. Android/Firefox/Chrome network reachability remains a separate required test.

## 4. Current evidence matrix

| Service | Public backend | Server media | Binary relay | Early read | Browser-origin test |
|---|---|---|---|---|---|
| Mazupo CF-SFU | Yes, public keys | SFU video confirmed; audio documented, test pending | Yes, bidirectional DataChannel | **PASS** | Token API PASS; two-page DataChannel PASS |
| Weblink TURN | Yes, open credential endpoint | **TURN audio RTP PASS** | DataChannel over TURN PASS | Live packets, no storage | CORS/preflight PASS |
| CopyPaesto | Yes, app-specific Worker | No server media | Worker WebSocket file fallback in source | Source says streaming; live test pending | Health PASS |
| YSTP | Public site found | No | Source supports binary WS | Source says streaming | WebSocket test FAIL |
| P2PCF | Old public endpoint | No; signaling only | No server media | N/A | Browser fetch FAIL |
| Cloudflare Meet | Public demo | SFU audio/video | No file transport established | N/A | Public demo available |
| FHS | No shared deployment found | No | Yes, after upload | **FAIL early-read** | Self-deploy only |

## 5. Next experiments

1. Finish the live CopyPaesto 40 MiB file test with direct WebRTC deliberately disabled; verify Worker WebSocket binary frames and receiver progress before sender completion.
2. Test Mazupo public SFU audio RTP with synthetic browser audio, then measure larger DataChannel chunks (16/32/64 KiB) and 1–10 MiB total transfer.
3. Test Weblink TURN relay from Android Chrome/Firefox on Turkish Wi-Fi and mobile networks. Do not assume the public endpoint is a production service.
4. Inspect Cloudflare Meet public demo for two-party audio path and use it as a second SFU testbed.
5. Continue image-only search. Distinguish image upload support from early-read; multipart object storage remains non-early-readable until finalization.
6. Only after the public services are understood, decide whether to deploy our own Cloudflare Worker/SFU. No VoiceLink production changes or diagnostic page are authorized by this research.
