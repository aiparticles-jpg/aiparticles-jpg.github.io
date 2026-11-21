# VoiceLink — Stage A: public streaming/relay services (registration-first inventory)

**Research date:** 2026-11-22  
**Scope:** identify public services that can carry browser-originated messages/streams, prioritizing (1) no user registration, then (2) one-time developer setup/credentials with no registration by VoiceLink callers.  
**Status:** desk research only. No endpoint in this document has yet been load-tested from the VoiceLink page or from a Turkish mobile carrier. “Public” and “free” do not mean reliable, private, or suitable for production.

## Acceptance criteria

1. **Priority A — no registration:** both callers can connect from the browser without creating accounts, entering API keys, or asking the user to authorize a third-party account. A locally generated cryptographic identity is acceptable; it is not a service account.
2. **Priority B — one-time app provisioning:** the developer creates a project/key once and embeds only public/client-safe configuration in the static app; callers do not register or enter credentials. Secrets must never be placed in GitHub Pages JavaScript.
3. **Priority C — not actually a streaming relay:** services that only help discovery/signalling, or have strict notification quotas, are recorded for completeness but must not be presented as a media/data-stream transport.
4. Keep separate: (a) raw arbitrary-message relay, (b) signalling only, (c) P2P path establishment, and (d) true media relay. Do not conflate them.

## Candidate comparison

| Priority | Candidate / public endpoint | Registration for callers | Browser path | What it can carry | Main constraints / risks | Stage A verdict |
|---|---|---|---|---|---|---|
| A1 | **EMQX public MQTT** — `broker.emqx.io:8084`, WSS path `/mqtt` | **None**; shared public broker | MQTT over secure WebSocket | Arbitrary MQTT payloads, publish/subscribe; two topics can form A→B and B→A | Shared/public topics; anyone who discovers a topic can subscribe or publish. No SLA, privacy, or guaranteed throughput. Payload/message and rate limits need live verification. Encrypt application payload end-to-end and use high-entropy per-call topics. | **Top practical no-account stream candidate.** First MQTT endpoint to test. |
| A1 | **HiveMQ public broker** — `broker.hivemq.com` (WebSocket ports commonly listed as 8000 WS / 8884 WSS) | **None** for its shared public broker | MQTT over WebSocket; use WSS from HTTPS page | Same MQTT publish/subscribe pattern; arbitrary message payloads | Official HiveMQ page confirms no account for shared public broker, but the exact current WSS port/path and limits should be confirmed against live broker docs before implementation. Shared/public, no production guarantee. | **Top practical no-account alternative** to EMQX; verify exact WSS endpoint in next pass. |
| A1 | **Nostr public relays** — examples: `wss://relay.primal.net`, `wss://nos.lol`, `wss://relay.damus.io` | **No service account.** Client generates its own keypair and signs events. | Native WebSocket protocol (NIP-01) | Publish events and maintain live subscriptions; ephemeral event kinds `20000–29999` are not expected to be stored | Each relay has its own policies and limits. Some require NIP-42 auth, payment, proof-of-work, or restrict writes. NIP-11 must be checked per relay. Event envelope/signature overhead; event rates may be anti-spam limited. Ephemeral events are not a durable inbox. | **Very interesting no-registration candidate** for small signalling/control packets and possibly a packet-stream experiment. Do not assume sustained 25 events/s until measured. |
| A1 (research only) | **libp2p Circuit Relay v2** — decentralized public relay peers; no single universal endpoint | No user account; peer identity is generated locally | Browser uses libp2p transports (typically WSS/WebTransport/WebRTC) and Circuit Relay v2 | Bidirectional libp2p streams; can help establish browser-to-browser WebRTC through a relay | No official guaranteed public relay service or stable public endpoint list was established in this pass. Relays are resource/time/bandwidth constrained. Need identify currently active peers, compatible transports, reservation policies, and Turkish mobile reachability. | **Highest-interest P2P architecture**, but not yet an actionable endpoint. Keep as a separate discovery task, not a ready-made free relay. |
| A1 (limited) | **PeerJS Cloud** — default cloud PeerServer (cloud service on `0.peerjs.com:443`) | **No account or API key** when default host/key are omitted | PeerJS signalling over HTTPS/WSS; then WebRTC DataChannel/media | Signalling only; after negotiation, data/media are direct P2P | Does not relay the actual stream. If direct WebRTC fails because of NAT/firewall, a TURN server is still needed; PeerJS FAQ says data does not pass through PeerServer except when TURN is used. | **Useful no-account signalling fallback**, not a solution to the no-TURN connectivity problem. |
| A1 (already in project, not a stream) | **ntfy.sh** — topic-based public notifications | No account for basic public topics | HTTP publish + HTTP/SSE/WebSocket subscription | Small notification/control messages | Public topics; 4,096-byte message limit, default 250 messages/day on ntfy.sh, request throttling. Larger messages become attachments, which is not a low-latency stream. | **Exclude as continuous stream.** Keep for wake-up/notification and low-rate signalling only. |
| B1 | **Supabase Realtime Broadcast** (existing VoiceLink project) | Callers can use app-provisioned anonymous access; developer must own/configure project and policies | WebSocket Realtime channel | Broadcast messages to channel subscribers | Requires project URL + public anon key and safe RLS/channel policy; service account/project setup is not zero-setup. Free quotas and message-rate limits apply. Not P2P. | **Best low-friction registered-service comparison** because project integration already exists. |
| B1 | **Ably** | No caller account if app uses developer-provisioned client auth/token; developer must create app and protect signing secret | WebSocket Pub/Sub | Arbitrary messages/events | Requires app/key or token provisioning. Free-tier message allowance makes continuous high-rate streaming unsuitable without checking message accounting and bandwidth. Centralized service. | Good control-plane comparator, not first choice for continuous media. |
| B2 | **Pusher Channels** | No caller account with app key; developer must create application | WebSocket Pub/Sub | Events/messages | Developer setup required; free daily message and connection caps make sustained 25 Hz stream short-lived. | Lower priority than Supabase/Ably. |
| C | **test.mosquitto.org** | Anonymous MQTT/WebSocket access | Official config currently shows anonymous WS on port 8080 | MQTT messages | Official live config shows listener 8080 with anonymous access, but the TLS/WSS listener is commented out/replaced; therefore it is not a safe direct WSS choice for the HTTPS VoiceLink page at the time checked. | Do not use as first browser endpoint unless secure WebSocket service is verified separately. |
| C | **Firebase Realtime Database** | Callers can be anonymous if app/project config and rules allow; developer setup required | HTTPS/WebSocket-backed database SDK | JSON synchronization, not a raw binary relay | Connection and usage quotas; JSON/database semantics and security rules make it a poor fit for a high-rate arbitrary stream. | Not a leading candidate. |
| C | **XMPP PubSub / Matrix** | Depends on server; anonymous registration is not generally guaranteed | XMPP WebSocket or Matrix HTTPS sync | Structured messages/events | Server-specific registration, payload, rate and retention policies; neither is a standard open anonymous high-rate binary stream endpoint. | Keep out of first test batch. |

## Why the no-registration shortlist is ordered this way

1. **EMQX MQTT** is the cleanest immediate experiment: exact public WSS endpoint and path are published by the operator; MQTT is designed for bidirectional publish/subscribe and does not require a user account on the public broker.
2. **HiveMQ public MQTT** is a second independent broker implementation. The operator explicitly says its shared public broker needs no account; confirm its current secure WebSocket port before testing from an HTTPS page.
3. **Nostr** is unusual and promising because it is a decentralized WebSocket event relay network with locally generated identities, not service accounts. It supports live subscriptions and ephemeral event kinds. Its social-network anti-spam policies and event framing make it more appropriate for signalling/control or a deliberately bounded packet experiment than an assumed continuous media path.
4. **libp2p Circuit Relay** is the most architecturally attractive P2P option, but the missing piece is a vetted public relay endpoint inventory. The protocol itself does not promise an unlimited shared public relay service.
5. **PeerJS Cloud** is extremely easy and registration-free, but it only brokers WebRTC signalling. It does not solve calls that need TURN.

## Important capacity sanity check

The existing experiment's nominal load (1 KiB × 25 messages/s) is approximately:
- 25 KiB/s payload in one direction;
- 92.16 MB/hour decimal in one direction;
- 2.16 million messages/day.

A brokered A→B stream normally consumes ingress and egress capacity (and a two-way call doubles the direction count). MQTT/Nostr public relays must therefore be treated as feasibility experiments, not presumed free continuous infrastructure. Base64 and protocol envelopes increase the wire size. These figures describe the experiment payload, not the actual VoiceLink audio codec/bitrate.

## Security and privacy rules

- Never send plaintext audio, SDP credentials, private keys, contact names, or stable personal identifiers through a public shared broker.
- Use authenticated encryption end-to-end between the two VoiceLink devices; TLS/WSS only protects each hop to the broker.
- Use unpredictable per-call topic/channel identifiers, but do not treat topic secrecy as authentication.
- Include sequence number, timestamp, expiry, and replay protection in packet envelopes.
- Assume public services can log IP addresses, connection metadata, timing, topic/event metadata, and message sizes.
- Public shared services may change policy, throttle, disconnect, or disappear without notice. Do not make them the sole production call path.

## Next work (Stage A2 — endpoint verification, still no application migration)

1. Check the EMQX WSS endpoint from a browser-compatible MQTT client: TLS handshake, WebSocket upgrade, MQTT CONNECT without credentials, SUBSCRIBE/PUBLISH in both directions, binary payload behavior, maximum payload, disconnect/reconnect behavior.
2. Repeat for HiveMQ only after confirming its current WSS endpoint and anonymous access.
3. Inspect NIP-11 documents for `relay.primal.net`, `nos.lol`, and one additional currently healthy relay; record `auth_required`, `payment_required`, `restricted_writes`, `max_message_length`, `max_subscriptions`, and any published rate limits. Then test publish/subscribe with ephemeral events only.
4. For libp2p, discover and validate actual public Circuit Relay v2 peer multiaddresses; do not use a relay address copied from a tutorial's localhost example.
5. Record all tests as **endpoint reachability/transport feasibility**, not as evidence of poor-network robustness. Do not resume generic synthetic bad-network testing unless a separate research question justifies it.

## Sources

- EMQX public MQTT broker and exact ports/path: https://www.emqx.com/en/mqtt/public-mqtt5-broker
- HiveMQ public broker (no account for shared broker): https://www.hivemq.com/mqtt/public-mqtt-broker/
- Mosquitto current public test-server configuration (anonymous WS; WSS listener commented out): https://test.mosquitto.org/config/
- Nostr NIP-01 (WebSocket publish/subscribe; event kinds; ephemeral range): https://github.com/nostr-protocol/nips/blob/master/01.md
- Nostr NIP-42 (relay authentication is optional and relay-specific): https://github.com/nostr-protocol/nips/blob/master/42.md
- Nostr relay information / NIP-11 fields and live Primal example (Oct 2026): https://nostrcg.github.io/devguide/reference/relay-info/
- Nostr relay monitoring and examples of currently listed/checked relays: https://profilestr.com/relays
- libp2p browser connectivity and transport requirements: https://libp2p.io/docs/browser-connectivity/
- libp2p Circuit Relay v2 (resource-constrained, encrypted relayed connections): https://libp2p.io/docs/circuit-relay/
- js-libp2p browser relay guide (discovery and relay constraints): https://docs.libp2p.io/guides/webrtc-browser-connectivity/
- PeerJS Cloud default (no host/key required): https://peerjs.com/server/cloud
- PeerJS FAQ (PeerServer is signalling; data is direct unless TURN is used): https://peerjs.com/client/faq
- ntfy message/rate/size limits: https://docs.ntfy.sh/publish/
- Supabase Realtime Broadcast: https://supabase.com/docs/guides/realtime/broadcast
- Ably free plan: https://ably.com/docs/platform/pricing/free
- Pusher Channels pricing: https://pusher.com/channels/pricing/
- Firebase Realtime Database usage limits: https://firebase.google.com/docs/database/usage/limits

**Conclusion:** the first concrete no-registration tests should be EMQX WSS and HiveMQ WSS; Nostr is the most interesting additional event-relay experiment; libp2p is the most interesting P2P direction but needs a real public-relay inventory. PeerJS Cloud is worth keeping as signalling only, not as a media relay.


## Stage A1 supplement — quota scope and identity (2026-11-22)

This supplement records the additional quota research. **A missing published quota is not evidence of an unlimited service.** “Unknown/not disclosed” is intentional; do not infer a per-client or per-IP policy merely because the protocol exposes a client identifier.

| Service | Caller registration | Published limits / constraints found | What the limit is applied to (documented scope) | Automatic/client identity and confidence |
|---|---|---|---|---|
| **EMQX public MQTT** | None | Public broker endpoint: `broker.emqx.io:8084`, WSS path `/mqtt`. No numeric public-broker connection, message-rate or bandwidth quota established in the operator page reviewed. Public shared broker; messages are visible to other broker users. | **Not disclosed** for this public broker. Do not transfer EMQX Cloud Serverless quotas to the separate public broker. | MQTT Client ID identifies an MQTT client/session, but no evidence found that public-broker quotas are charged per Client ID. IP/connection/global anti-abuse scope remains unknown. **Confidence: high on endpoint; low/unknown on quota scope.** |
| **HiveMQ public MQTT** | None for shared public broker | Public shared broker is for testing; no numeric public quota found in the operator page reviewed. Confirm exact current WSS port/path before browser use. | **Not disclosed.** | MQTT Client ID exists at protocol level; quota accounting by Client ID/IP/connection/global pool is not published in the reviewed material. **Confidence: high on no-account access; unknown quota scope.** |
| **Nostr public relays** | No service account; client generates a local keypair | Relay-specific NIP-11 fields can include `max_message_length`, `max_subscriptions`, `auth_required`, `payment_required`, `restricted_writes`, `min_pow_difficulty`. One documented Primal relay example reported 1,000,000-byte max message and 20 subscriptions; this is one relay example, not a network-wide guarantee. Ephemeral event kinds 20000–29999 are not expected to be stored. | NIP-11 does not standardize whether rate limits are per IP, pubkey, connection, or global. Relay-specific policies must be checked individually. | Event author pubkey identifies the signer, but does not prove quota accounting uses pubkey. **Confidence: high on protocol fields; unknown on most rate-limit identity scopes.** |
| **libp2p Circuit Relay v2** | No user account; local Peer ID | Relay advertises resource limits such as reservation duration and data limits; concrete values and admission policy depend on each relay. No universal public relay quota. | Per-connection reservation limits are represented by relay protocol limits; broader IP/global anti-abuse policy depends on operator. | Peer ID identifies the peer; it is not proof that all quotas are per Peer ID. **Confidence: high on protocol model; relay-specific values unknown.** |
| **PeerJS Cloud** | No caller account for default cloud PeerServer | Signalling service only; no public numeric quota/identity policy established in reviewed docs. It does not relay application media/data as a TURN replacement. | Not disclosed in reviewed public docs. | Peer ID is a signalling identity; no evidence it is the quota key. **Confidence: high on signalling-only distinction; quota scope unknown.** |
| **ntfy.sh** | No account for public topics | Default ntfy.sh visitor daily message quota is 250/day; default request bucket starts at 60 and refills at 1 request per 5 seconds; visitor subscriptions default 30; message payload limit 4,096 bytes. These are ntfy.sh deployment defaults and may change. | Visitor-based limits use visitor identity derived from source IP (or forwarded IP behind proxy); IPv4/IPv6 prefix handling is configurable. Other limits may be global or subscriber-related depending on feature/configuration. | **IP / configured IP prefix** is explicitly used for visitor identity. This is the clearest published IP-based example in this candidate set. |
| **Supabase Realtime (Free)** | No end-user account required if app provisions anonymous access; developer project required | Free plan: 200 concurrent connections, 100 messages/s, 100 channel joins/s, 100 channels/connection, 256 KB Broadcast payload, replay retention 72h and up to 25 replay messages/request (current limits page reviewed). | Primarily **project/plan-wide** quotas; connection cap counts live Realtime connections, not a per-device anonymous UID allowance. | Anonymous Auth provides a UID, but it does not turn project-level quotas into per-UID quotas. Each browser/device connection contributes to concurrent connections. |
| **Ably Free** | Developer account/app required; callers can use app-provisioned auth/token | Free package documentation and detailed limits page disagree on concurrent connections (200 vs 500); do not rely on either until confirmed in dashboard/current plan. Other documented limits include monthly message allowance, aggregate account bandwidth, per-connection/per-channel message rates, and a per-clientId concurrent-connection cap. | Mixed scope: account/application aggregate quotas plus per-connection, per-channel and per-clientId limits. | `clientId` is a meaningful service identity for some caps, but not all quotas. Documentation inconsistency on free concurrent-connection allowance must be resolved before sizing. |
| **Pusher Channels Free** | Developer account/app required; callers need no individual account | Free tier: 200,000 messages/day and 100 concurrent connections (pricing page reviewed). A publish counts as one message plus each subscriber delivery; one publish to 50 subscribers can count as 51. | Application-wide daily message allowance and concurrent connections for the Channels app. | Connection count reflects live connected clients; channel subscriptions do not each create another connection. No separate per-device quota key established. |
| **Firebase Realtime Database Spark** | Developer project required; anonymous client access possible if configured | Spark plan: 100 simultaneous connections; database documented global maximum is much higher (200,000). JSON database model, not raw binary relay. | Database/project-wide concurrent-connection limit. One browser tab, mobile device, or server app counts as a connection. | Not a unique user/account quota: tabs/devices create separate connections. |
| **Mosquitto test.mosquitto.org** | Anonymous access available | Official config reviewed exposes anonymous WebSocket listener on port 8080; TLS/WSS listener was commented out. No numeric quotas established. Not suitable directly from an HTTPS page until WSS is confirmed. | Not published in reviewed config. | MQTT Client ID exists, but no evidence of per-ID/IP quota policy. |
| **XMPP PubSub** | Depends on server; anonymous registration is not guaranteed | XEP-0060 defines publish/subscribe semantics; payload, rate, storage and connection limits are server-specific. | Server-specific; may be account/JID, IP, connection or global. | JID/account and stream connection identities exist; no universal quota model. |
| **Matrix homeservers** | Usually account required; server-dependent exceptions | Event-size, rate, connection and retention policies are homeserver-specific. Not a generic raw binary stream. | Homeserver-specific; may combine user/account, IP, request and global limits. | Matrix user ID and access token identify a user/session; quota scope varies by homeserver. |

### Interpretation for VoiceLink

- A protocol-level identifier (MQTT Client ID, Nostr pubkey, libp2p Peer ID, PeerJS Peer ID) must not be confused with the operator's quota key.
- **ntfy.sh is the clearest explicitly IP/visitor-based case** in this inventory.
- **Supabase, Pusher and Firebase primarily expose project/application/database-level caps**, so two callers sharing one VoiceLink project consume the same pool.
- **Ably has mixed aggregate and client/channel/connection limits**, and its free concurrent-connection documentation needs reconciliation.
- For EMQX, HiveMQ and most Nostr relays, exact quota accounting identity is **not publicly established** in the sources reviewed. Live tests may reveal behaviour but cannot prove the operator's internal accounting key.
- A public service may apply undocumented anti-abuse controls in addition to published limits. Treat all public brokers/relays as revocable experimental infrastructure.

