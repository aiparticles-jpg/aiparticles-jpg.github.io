# Candidate register

Updated: 2026-11-22. Discovery inventory; evidence levels apply per capability, not per vendor. See [Stage A detailed public transport tests](../public-stream-transports-stage-a.md).

## 1. Server-side audio/video

| Candidate | Media route | Free/test offer | Access model / caveat | Verdict / next step |
|---|---|---|---|---|
| **LiveKit Cloud** | Official docs confirm a managed global-mesh WebRTC SFU forwarding media between participants. | Build page lists 5,000 WebRTC minutes, 100 concurrent connections and 50 GB downstream data; free allowances are hard caps. | Project API key/secret; likely server-minted room tokens. | **P1, E1.** Strongest explicit SFU candidate. Verify exact quota definitions, browser SDK and relay-only/blocked-P2P behaviour. |
| **Agora RTC + Cloud Proxy** | Official docs say proxy receives client media and forwards it to Agora SD-RTN. Web SDK can force UDP or TLS 443 and emits an event confirming proxy use. | RTC includes 10,000 free minutes/month. Automatic Cloud Proxy mode is listed free; forced UDP/TCP proxy pricing has a $500 monthly minimum. | Owner app/project; token/auth model to inspect. | **P1 research, E1.** Strong explicit relay proof, but forced proxy likely too expensive. Check if automatic mode can be made to relay and whether it is free. |
| **Sendbird Calls** | Pricing explicitly distinguishes P2P from server-relayed voice/video minutes. Actual topology and SDK control still need inspection. | Voice: P2P $0.0010 vs server-relayed $0.0015 per user-minute. Video: P2P $0.0014 vs server-relayed $0.0035. Free trial advertised; no free-forever relay quota established. | Owner app and SDK authentication. | **P1, E1.** Especially promising because server-relayed billing is explicit. Inspect relay selection and trial inclusion. |
| **CometChat Calls** | Calls supported; actual P2P/TURN/SFU path unknown. | Build plan $0 development, up to 100 users and 10,000 voice/video test minutes. | Self-owned workspace; caller identity/token model to inspect. | **P1 testbed, E1.** Inspect SDK endpoints, ICE route and image/file attachment behaviour. |
| **ZEGOCLOUD** | Hosted RTC/live-stream product; media path/relay control unknown. | 10,000 complimentary minutes; first-registration package valid 30 days. | Owner project and SDK auth/token requirements. | **P1 research, E1.** Verify route, expiry, quota and browser SDK. |
| **RTCExpress** | Free-plan voice described as P2P; server relay not established. | Previously found free plan: 100 chat MAU and 2,000 voice participant-minutes. | Requires backend-minted short-lived tokens. | **P3 for server media.** Keep as P2P control only. |
| **Vocantly** | WebRTC calls advertised; likely P2P/TURN fallback, provider relay/SFU unknown. | Free quota unknown. | Public key + origin allowlist for anonymous browser session; secret server-side. | **P2 / UNKNOWN.** Inspect call architecture before spending test effort. |
| **Crisp** | Live calls documented; actual media route unknown. Live calls appear paid-tier. | Free chat plan; live calls require paid Essentials per prior pricing review. | Owner workspace; visitor session. | **P1 audio-message research, P2 live media.** Separate audio message upload from calls. |
| **Laleo Chat** | Browser voice/video advertised; P2P vs provider relay unknown. | Free plan: 3 widgets, one concurrent visitor chat/call; no card advertised. | Owner email OTP; visitors expected anonymous. | **P1 testbed.** Inspect own widget, API, network calls and media endpoints. |
| **Botpress Voice** | Voice interaction with AI agent; not generic client-to-client media. | Free plan has limited conversations; voice inclusion needs current confirmation. | Owner bot/project. | **P3 for transport**, possible infrastructure clue only. |

Media sources:
- LiveKit SFU: https://docs.livekit.io/reference/internals/livekit-sfu/
- LiveKit pricing: https://livekit.com/pricing
- LiveKit quotas: https://docs.livekit.io/deploy/admin/quotas-and-limits/
- Agora Cloud Proxy: https://docs.agora.io/en/realtime-media/rtc/build/manage-connection-and-quality/cloud-proxy
- Agora proxy pricing: https://www.agora.io/en/pricing/cloud-proxy/
- Agora RTC pricing: https://docs.agora.io/en/realtime-media/rtc/reference/pricing
- Sendbird Calls: https://sendbird.com/docs/calls
- Sendbird P2P/server-relayed prices: https://sendbird.com/pricing/calls
- CometChat: https://www.cometchat.com/pricing?tab=voice-video-calling
- ZEGOCLOUD: https://www.zegocloud.com/pricing
- ZEGOCLOUD complimentary minutes: https://www.zegocloud.com/docs/console/faqs/billing/complimentary-package
- Crisp: https://docs.crisp.chat/references/rest-api/v1/
- Laleo: https://laleo.chat/ and https://laleo.chat/pricing
- Vocantly: https://docs.vocantly.com/
- RTCExpress: https://rtc.devsquarelabs.com/

## 2. Image and arbitrary-file delivery

| Candidate | Browser / independent-client evidence | Image status | Early-read status | Verdict |
|---|---|---|---|---|
| **paste.gg** | Browser-origin and independent-runner create/read/delete passed; 4,096-byte cross-runner payload. | Generic paste/multi-file object, not chat image API. | Not tested. | **PASS E4 ordinary object transfer.** Anonymous expiry up to 7 days; 10 MiB total / 5 MiB per file in prior API research. |
| **Svix Play** | Anonymous browser token, event POST/history GET and independent runner read/ack passed; 1,445-byte event body. | Base64 event payload, not image-specific. | No partial upload. | **PASS E4 mailbox**, not streaming file storage. Retention/quota unknown. |
| **MantleDB** | Browser and independent-client tests passed; 24 KiB binary-as-base64 JSON, PATCH and CORS ACAO *. | No image processing. | No early-read. | **PASS E4 key/value object.** Previously reviewed free tier: 100 entries, 64 KB/entry; namespace security matters. |
| **AISense** | Browser 256 KiB and independent-runner 128 KiB tests passed. | Generic file. | Not tested. | **PASS E4 ordinary file transfer.** |
| **TempFile.org** | Browser upload/read/delete and independent-client tests passed. | Generic file. | Not tested. | **PASS E4 ordinary file transfer.** Expiry options previously observed: 1–48h. |
| **beacon.host** | Browser and independent-client tests passed. | Generic anonymous file. | Not tested. | **PASS E4 ordinary file transfer.** Previously observed 24h retention and approx. 4 MB request size. |
| **WaifuVault** | Browser and independent-client tests passed. | Generic file. | Not tested. | **PASS E4 ordinary file transfer.** |
| **kappa.lol / segs.lol** | Browser and independent-client tests passed; 8 KiB hash verified; delete returned 200. | Generic file. | Not tested. | **PASS E4 ordinary file transfer.** |
| **Telegra.ph** | Browser anonymous account and page create/read passed. | Page content can represent images, but image upload/receiver flow not tested. | No early-read; pages persist and no delete API documented. | **E3 anonymous page API; image transport UNKNOWN.** Avoid orphan public pages. |
| **Write.as** | Server-side create/read/update/delete and cross-runner verified; browser-origin fetch failed. | Not a browser image transport on current evidence. | Not tested. | **FAIL_BROWSER for GitHub Pages origin; server-side object semantics E4.** |
| **Cloudflare R2 multipart** | Docs only; browser upload requires signed URLs/backend and bucket config. | Generic object storage. | Multipart parts are assembled into final object only on completion; not early-readable as normal object. | **E1 reference / conditional.** Resumability, not receiver-visible streaming. |
| **Amazon S3 multipart** | Docs only; account, credentials/presigned URLs and CORS needed. | Generic object storage. | Object is assembled and normally readable after CompleteMultipartUpload. | **E1 reference / conditional.** Chunked does not mean early-readable. |

Sources:
- R2 upload objects: https://developers.cloudflare.com/r2/objects/upload-objects/
- R2 multipart API: https://developers.cloudflare.com/r2/api/workers/workers-api-reference/
- S3 multipart semantics: https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html

**Important negative result:** conventional S3-compatible multipart is designed for parallelism, retry and resumability. It does not automatically expose the final object to another client before completion. Prioritize APIs that expose uploaded chunks as separate readable objects, appendable objects, or live streams.

## 3. Chat products and SDKs as testbeds / infrastructure clues

| Candidate | Messaging / image / audio | Live media | Access model | Status |
|---|---|---|---|---|
| **Laleo Chat** | Live chat and visitor history; attachment/API details to inspect. | Browser voice/video advertised; route unknown. | Owner email OTP; anonymous visitors expected. | **P1 self-owned testbed.** |
| **Vocantly** | Messaging SDK, anonymous session and WebSocket; attachments unknown. | WebRTC voice/video advertised; route unknown. | Public key + allowlisted origin for anonymous session; secret server-side. | **P2 protocol candidate.** |
| **Crisp** | Audio messages supported by SDK/API; image/file features and free-tier access need checking. | Live calls paid; route unknown. | Owner workspace; visitor session. | **P1 audio-message testbed; P2 live media.** |
| **CometChat** | Chat and attachments; inspect image/file upload and free Build. | Calls included in Build test allowance; route unknown. | Self-owned app, up to 100 users on free Build. | **P1 testbed.** |
| **Sendbird** | Chat SDK and image/file messages to inspect. | Calls pricing explicitly separates P2P/server-relayed. | Owner app and SDK auth. | **P1.** |
| **Botpress** | Text and AI voice interaction; arbitrary file/image relay not established. | AI voice, not generic client-client media. | Owner bot/project; visitors use widget. | **P3 transport.** |
| **Chatwoot** | Open-source chat and attachments; self-hosted Community Edition. | Voice not included in Community Edition; external voice channels need providers. | Own server, PostgreSQL and Redis required. | **P2 architecture/code study.** |
| **RTCExpress** | Hosted chat SDK. | Free voice described as P2P. | Owner project and backend token minting. | **P3 for server media.** |
| **Tidio** | Visitor chat and Lyro playground; generic visitor-to-visitor mailbox not proven. | No relevant generic server media found. | Owner account; playground internal. | **P3 research only.** |
| **tawk.to** | Hosted widget; public visitor API for arbitrary history/write not established. | No relevant server media established. | Owner widget; REST API is agent-oriented. | **P3 research only.** |
| **Voiceflow** | Chat and voice-agent audio. | Voice agent, not generic two-browser relay. | Project credentials stay server-side. | **P3 transport; architecture clue.** |
| **WebTalk.sh** | Free hosted support widget advertised. | No voice feature established. | Owner signup; visitors anonymous. | **P2 pending API review.** |

Chat sources:
- CometChat: https://www.cometchat.com/pricing?tab=voice-video-calling
- Sendbird Calls: https://sendbird.com/docs/calls
- Sendbird relay pricing: https://sendbird.com/pricing/calls
- Crisp SDK: https://docs.crisp.chat/guides/chatbox-sdks/web-sdk/npm/
- Chatwoot: https://www.chatwoot.com/pricing/self-hosted-plans
- Botpress: https://botpress.com/voice
- Voiceflow: https://www.voiceflow.com/docs/api-reference/agent-runtime/chat
- Tidio: https://help.tidio.com/articles/test-lyro/
- WebTalk: https://webtalk.sh/

## 4. Previously tested browser transports and mailboxes

Preserve these outcomes; do not retest without a specific reason:
- **MQTT:** HiveMQ public broker, Mosquitto test broker and ConnectMQ previously passed independent-runner message exchange; EMQX showed loss at higher frequency; Nostr relays passed rare-message tests with occasional loss.
- **WebTorrent:** tracker.webtorrent.dev passed one-runner 1 KiB, 25 packets/s, 125/125 and recovery; not tested on two phones and not a server mailbox.
- **OneJSONFile:** server API works but browser OPTIONS lacks ACAO.
- **tmp0.cc:** API explicitly lacks CORS for arbitrary foreign browser origins.
- **Webhook.site:** browser token creation failed.
- **KeyVal:** HTTP 200 responses contained error bodies; not a pass.
- **PasteMyst, bpa.st, pb.nekoid.cc, Pastebin.ai, Pasters.io, rTS Paste Service and Write.as:** browser-origin requests failed in prior probes; see Stage A notes for detail.

## 5. Immediate research queue

1. LiveKit: verify free WebRTC quota definition; two browser clients; prove SFU path.
2. Sendbird: inspect SDK/source for server-relayed mode, media endpoints and whether trial includes relay.
3. CometChat Build: self-owned app; inspect image upload, audio messages, ICE route and endpoints.
4. Agora: compare automatic and forced Cloud Proxy; forced mode's $500 minimum likely blocks practical use.
5. ZEGOCLOUD: verify trial and actual media path.
6. Build image-specific shortlist: hosted image APIs, chat attachment systems, image CDN upload APIs and appendable/live-readable image objects.
7. Search for APIs where uploaded chunks are individually readable before final object assembly.
8. Explore Laleo/Vocantly only in self-owned workspaces; capture client network requests and third-party media provider clues.
9. Later test Android Chrome/Firefox and Turkish mobile networks separately from GitHub browser-runner evidence.


## 6. Follow-up findings — image upload and actual call relay (2026-11-22)

### Sendbird Calls: TURN is documented, but default is still P2P-first

The Sendbird Calls relay-protocol documentation says the SDK first attempts direct P2P using STUN; if the firewall/NAT still prevents direct connectivity, it uses TURN to relay media between the two users. This is a genuine server-side fallback, but it is not evidence that all calls traverse Sendbird infrastructure or that clients can force relay-only mode. The page notes most WebRTC traffic uses STUN/direct connectivity. The published server-relayed price is therefore consistent with a metered TURN fallback, not necessarily an SFU.

- Relay protocol reference (React Native Calls SDK; older doc, last updated 2022): https://sendbird.com/docs/calls/sdk/v1/react-native/ref/index.html
- Pricing distinguishing P2P/server-relayed: https://sendbird.com/pricing/calls
- **Updated verdict:** server TURN fallback confirmed at documentation level (E1); forced-relay capability and free trial coverage remain UNKNOWN. Do not count it as guaranteed relay until tested with P2P blocked/relay-only.

### Sendbird Chat images/files: ordinary upload, not proven progressive delivery

The JavaScript Chat SDK supports file messages, including image/* and video/*, and the documented default maximum file size is 25 MB per attachment. The SDK exposes upload progress callbacks and only then sends the file message using the returned URL. Thumbnail generation is supported for image/video attachments. These facts establish image/file attachment support and upload progress for the sender, but do not establish that the recipient can fetch the original bytes while the sender is still uploading. Treat as ordinary attachment delivery until a two-client early-read test proves otherwise.

- Message types and 25 MB default: https://sendbird.com/docs/chat/sdk/v4/javascript/message/overview-message
- Upload progress and returned file URL: https://sendbird.com/docs/chat/sdk/v4/javascript/message/sending-a-message/track-file-upload-progress-using-a-handler
- Thumbnail generation: https://sendbird.com/docs/chat/sdk/v4/javascript/message/managing-a-message/generate-thumbnails-of-a-file-message
- Platform API raw binary upload: https://sendbird.com/docs/chat/platform-api/v3/message/messaging-basics/send-a-message
- **Updated verdict:** image/file upload E1; early-readable/streaming E0/UNKNOWN.

### Object storage: multipart upload is not early-readable

Cloudflare R2 and Amazon S3 both document multipart uploads as a staged operation: create upload, upload individual parts, then complete/assemble the object. The completed object becomes available as a normal object after completion. This is valuable for retry, resumability and parallel throughput, but it does not meet the receiver-starts-reading-before-sender-finishes requirement. A possible alternative architecture is to expose each committed chunk as a separate object/message, with sequence numbers and a final manifest; that is an application-level stream rather than a partially readable single object.

- Cloudflare R2 multipart: https://developers.cloudflare.com/r2/objects/upload-objects/
- Amazon S3 multipart: https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html

### New test priority from this pass

1. Sendbird Calls: determine if a web client can force TURN relay and inspect TURN credentials/endpoints; if not, simulate blocked P2P and verify automatic TURN fallback.
2. Sendbird Chat: test two independent browser clients with a synthetic PNG, observe whether message/URL becomes available before upload completion. SDK upload progress alone is not evidence.
3. Search image-specific APIs and chat SDKs for separately readable chunks, not only multipart upload.


## 7. Additional server-media candidates — second discovery pass (2026-11-22)

| Candidate | Server-side route | Free allowance / pricing | Access model / limitations | Priority |
|---|---|---|---|---|
| **Cloudflare Realtime SFU + TURN** | Official product is a managed SFU routing WebRTC audio, video and DataChannels between endpoints. Separate managed TURN service is available. | SFU + TURN share 1,000 GB/month free egress; beyond that $0.05/GB. TURN is free when used with SFU; standalone TURN is billed. | App Secret must remain on trusted backend. Browser talks WebRTC to SFU; backend handles signaling, authorization, session creation and publication discovery. Backend can be Workers, container or existing infrastructure; Workers are not mandatory. | **P0 research.** Very strong server-media + DataChannel candidate. Previous Cloudflare Workers/worker.dev reachability issue does not prove rtc.live.cloudflare.com media endpoints are inaccessible; test separately from Turkey. |
| **Daily Video SDK** | Official security docs say calls default to SFU and developers can override to P2P. Older Daily engineering post says calls start P2P and switch to SFU above four participants; this source conflict/possible product evolution must be resolved. TURN fallback also documented. | 10,000 free participant minutes/month; after that $0.004/participant-minute for standard video/audio, audio-only discounted. | Owner project/API credentials; browser SDK. Room/token auth model needs review. | **P0/P1.** Very promising if current SDK can force SFU for a two-person call. Verify with SDK topology setting and media stats. |
| **100ms** | Cloud conferencing platform with server-side SFU architecture described in its technical material; actual one-to-one topology and ability to force routing need verification. | Free: 10,000 conferencing minutes/month, 10,000 live-streaming minutes/month, smaller separate recording/encoding allowances. | Owner workspace, room/template setup and server API/token model. | **P1.** Strong free allowance; inspect whether two-person media always traverses SFU and whether browser clients can be anonymous behind app-issued tokens. |
| **Twilio Video** | Official docs explicitly state all participant media tracks go through Twilio Cloud SFU; TURN relays client-to-SFU traffic if direct connection to the SFU is blocked. | $0.004 per participant-minute; unlimited TURN relay listed. Free trial credit, not an ongoing free quota. | Owner account/project and server-issued access tokens. | **P1 architecture benchmark; P3 cost for production.** Very clear server-media route and useful test candidate while trial credit exists. |
| **Vonage Video API** | Two modes: Relayed (direct P2P, TURN fallback) and Routed (Vonage Media Router). Adaptive Media Routing may move one-to-one streams back to P2P when only one subscriber and no router-only features are active. | 100,000 free trial minutes for new customers (75,000 video sessions + 25,000 advanced features); trial, not a permanent monthly allowance. | Owner application; server creates session and generates client tokens. | **P1 research.** Server route exists, but 1:1 may adapt to P2P. Determine whether adaptive routing can be disabled or a supported router-only feature can guarantee media-server transit. |
| **Zoom Video SDK** | Cloud-managed video/audio SDK; official product material describes cloud media routing, but current per-session media topology and exact SFU/relay guarantee are not yet established. | 10,000 free minutes/month reported in Zoom developer fact sheet; confirm current plan/account scope. | Owner Build account and SDK authentication/signature generation. | **P1 research.** Interesting because SDK also advertises chat, raw data streams and file transfer; inspect whether those data/file paths traverse Zoom servers and what browser APIs expose. |

### Additional media sources
- Cloudflare Realtime SFU overview: https://developers.cloudflare.com/realtime/sfu/
- Cloudflare application architecture and backend boundary: https://developers.cloudflare.com/realtime/sfu/concepts/architecture/
- Cloudflare SFU quickstart: https://developers.cloudflare.com/realtime/sfu/get-started/
- Cloudflare Connection API: https://developers.cloudflare.com/realtime/sfu/api/
- Cloudflare DataChannels: https://developers.cloudflare.com/realtime/sfu/features/datachannels/
- Cloudflare TURN pricing and endpoints: https://developers.cloudflare.com/realtime/turn/
- Cloudflare SFU/TURN pricing: https://developers.cloudflare.com/realtime/sfu/platform/pricing/
- Cloudflare WebSocket media adapter: https://developers.cloudflare.com/realtime/sfu/features/media-transport-adapters/websocket-adapter/
- Daily security / default topology claim: https://www.daily.co/security/secure-calls/
- Daily topology article (older, describes P2P-first then SFU): https://www.daily.co/blog/how-our-new-european-call-server-region-can-benefit-call-performance/
- Daily Video SDK pricing: https://www.daily.co/pricing/video-sdk/
- 100ms pricing: https://www.100ms.live/pricing
- 100ms architecture: https://www.100ms.live/docs/get-started/v2/get-started/concepts/basics
- 100ms server-side WebRTC/SFU architecture: https://www.100ms.live/blog/webrtc-server-side
- Twilio Video pricing: https://www.twilio.com/en-us/video/pricing
- Twilio SFU architecture: https://www.twilio.com/docs/video/overview
- Twilio network / TURN behaviour: https://www.twilio.com/docs/video/networking-considerations
- Vonage media modes: https://developer.vonage.com/en/video/guides/smart-video
- Vonage technical architecture and token boundary: https://developer.vonage.com/en/video/technical-details
- Zoom Video SDK: https://developers.zoom.us/docs/video-sdk/
- Zoom Video SDK pricing fact sheet: https://godevelopers.zoom.us/blog/video-sdk-fact-sheet/

### Important Cloudflare Realtime distinction

This is a different product from the previously tested Cloudflare Worker signaling endpoint. The media endpoints are Cloudflare Realtime SFU/TURN. The product requires a backend holding App Secret, but its documentation explicitly allows that backend to run on Workers, a container, or existing infrastructure. Therefore the prior failure of worker.dev from a Turkish mobile network should not automatically eliminate this candidate. The SFU's browser media path and TURN TLS/443 reachability still need independent testing from the actual target networks.

### Updated research queue
1. Cloudflare Realtime: validate app provisioning, backend API calls, browser WebRTC to SFU, DataChannels, TURN/TLS 443, pricing counters and reachability from Turkey.
2. Daily: resolve P2P-first vs SFU-default documentation conflict and prove that a two-client call can be forced through SFU.
3. 100ms: establish two-party media topology and whether server routing is guaranteed.
4. Sendbird: test TURN fallback and whether relay-only can be forced.
5. Vonage: determine if a one-to-one routed session can remain on Media Router under adaptive routing.
6. Twilio: inspect free trial eligibility and test server-routed media; use as a control even if ongoing cost is unsuitable.
7. Zoom: inspect data stream/file transfer, free minute allowance and actual media topology.


## 8. DataChannels and chat-file APIs — additional findings (2026-11-22)

### Cloudflare Realtime DataChannels are a genuine server-mediated data transport

The official DataChannels guide describes a publisher creating a named DataChannel on the SFU and one or more subscribers attaching to it. The SFU forwards the publisher's messages to subscribers. Reliable ordered delivery is the default; publishers may also choose unordered and partially reliable delivery using max retransmits or a packet lifetime. This is not direct peer-to-peer DataChannel traffic: each endpoint's WebRTC connection terminates at the Cloudflare SFU, which forwards the channel data.

The browser setup requires backend-created SFU channel allocations and the returned negotiated channel IDs. The App Secret stays on the backend. The docs do not yet establish a maximum application message size suitable for large files; WebRTC SCTP/browser message limits and buffering must be tested. There is no durable inbox/history implied by DataChannels.

- Docs: https://developers.cloudflare.com/realtime/sfu/features/datachannels/
- Limits: https://developers.cloudflare.com/realtime/sfu/platform/limits/
- Pricing: https://developers.cloudflare.com/realtime/sfu/platform/pricing/
- **Verdict:** **P0 for live server-relayed binary/text packets, E1**. Next test: small binary payload, increasing sizes, two browser clients, ordered delivery, reconnect and buffer pressure. For file transfer, chunk into sequenced messages and measure limits; do not assume the SFU persists data.

### Zoom Video SDK file transfer is a separate chat-file path

The Zoom Video SDK web docs advertise file transfer and provide a Chat SDK file send/download API. A receiver gets a file message event with metadata, but the file URL is encrypted and cannot be fetched directly; the SDK's downloadFile method is required. It emits download progress and returns a Blob only after the SDK download flow. This proves hosted file messaging and progress reporting, but does not prove that the receiver can read partial file bytes before the sender upload completes.

- Web file-send/download docs: https://developers.zoom.us/docs/video-sdk/web/chat-send-files/
- SDK overview: https://developers.zoom.us/docs/video-sdk/
- **Verdict:** **E1 for file transfer; early-read UNKNOWN**. Worth inspecting as a self-owned test project if the free plan and browser support are acceptable.

### Zoom raw data vs file messages

Zoom's raw-data processor API exposes live audio/video frames for processing, but this is distinct from its chat file attachment API. Do not treat raw media processor access as arbitrary binary messaging. Its general SDK advertises data streams and file transfer, so inspect those APIs independently.

- Browser raw data: https://developers.zoom.us/docs/video-sdk/web/raw-data/


## 6. Cloudflare Worker and public backend research

A dedicated report now tracks public Cloudflare Worker endpoints, public keys, SFU/TURN services, file relays and self-deploy Worker projects: [cloudflare-workers.md](cloudflare-workers.md). Current strongest results: Mazupo public SFU DataChannels passed bidirectional binary early-read; Weblink public TURN passed forced relay audio RTP; CopyPaesto public Worker health passed and full file relay is under test.


## 7. Image-only upload APIs

See [image-upload.md](image-upload.md) for Uploadcare, Cloudinary, Imgur, ImgBB, ImageKit and Cloudflare Images. Uploadcare's official demo public key passed browser PNG upload and CDN retrieval; its Free plan is image-only. No early-readable partial image object has been confirmed.
