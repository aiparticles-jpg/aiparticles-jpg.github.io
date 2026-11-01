# p2p-voice-signaling

Cloudflare Worker + SQLite-backed Durable Object used by the Voice Link static app.

## What it does

- Creates one Durable Object instance per random 128-bit room ID.
- Allows at most two WebSocket clients in a room.
- Relays WebRTC SDP/ICE signaling messages.
- Relays encrypted binary audio frames only when clients choose the TCP/WebSocket fallback.
- Uses the Durable Objects WebSocket Hibernation API.
- Does not store SDP, ICE candidates, audio, room membership, or messages in persistent storage.

The TCP fallback is a prototype: the browser captures mono PCM at 16 kHz, encrypts frames with AES-GCM, and sends 100 ms frames over WebSocket. The Worker forwards opaque encrypted frames. The invite secret stays in the URL fragment / invite code and is never sent to the Worker.

## Deploy

1. Create a Cloudflare account and open Workers & Pages.
2. Install Wrangler locally if you want CLI deployment.
3. From this directory, authenticate and deploy:

   ```bash
   npx wrangler login
   npx wrangler deploy
   ```

4. Wrangler creates the SQLite-backed Durable Object migration defined in `wrangler.toml`.
5. Copy the deployed Worker URL, for example:

   `wss://p2p-voice-signaling.YOUR_SUBDOMAIN.workers.dev`

6. Edit `../js/config.js` in the GitHub repository and set `SIGNALING_URL` to that URL.

The Worker accepts WebSocket connections only from `https://aiparticles-jpg.github.io`. If you use a different Pages domain, update `ALLOWED_ORIGINS` in `src/index.js` before deploying.

## Free-tier considerations

The Worker and SQLite-backed Durable Objects can run on Cloudflare's Free plan, within its quotas. Hibernation avoids charging Durable Object duration while WebSockets are idle, but active TCP audio wakes the object for incoming messages. Incoming WebSocket messages count toward Durable Object request quotas (Cloudflare currently applies a 20:1 message-to-request ratio on the Free plan).

PCM is uncompressed: 16 kHz × 16-bit × mono = approximately 256 kbit/s in each direction before WebSocket/TLS overhead. This is suitable for a prototype, not an optimized production codec. Long calls and frequent use can consume the daily message quota. There is no automatic paid fallback in this project.

## Important limitations

- No TURN server is configured.
- Direct WebRTC requires compatible UDP/NAT/firewall behavior.
- TCP fallback requires WebSocket access to this Worker from both networks.
- A WebSocket/TCP relay is not guaranteed to bypass network restrictions.
- Only two participants are supported.
- This prototype has no account system, abuse reporting, or production-grade rate limiting.
