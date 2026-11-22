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
