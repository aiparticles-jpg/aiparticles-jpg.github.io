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
