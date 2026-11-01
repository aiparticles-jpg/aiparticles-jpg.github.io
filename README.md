# Voice Link

Experimental two-person browser voice calling app hosted as a static GitHub Pages site.

## Architecture

- **Frontend:** static HTML/CSS/JavaScript in the repository root.
- **Signaling:** Cloudflare Worker + SQLite-backed Durable Object in `worker/`.
- **Primary audio:** direct WebRTC using Google STUN; no TURN server.
- **Fallback audio:** encrypted 16 kHz mono PCM frames over WebSocket/TCP through the Worker.

## Setup

1. Deploy `worker/` using the instructions in [worker/README.md](worker/README.md).
2. Set the deployed Worker URL in [js/config.js](js/config.js).
3. Enable GitHub Pages for this repository (Deploy from branch `main`, folder `/`).
4. Open [https://aiparticles-jpg.github.io/](https://aiparticles-jpg.github.io/).

## Current prototype limitations

- Two participants per room.
- No TURN: some NAT/firewall combinations will not connect over direct WebRTC.
- TCP fallback relays encrypted, uncompressed PCM (approximately 256 kbit/s per direction) and is subject to Cloudflare Free quotas.
- The TCP fallback requires WebSocket access to the Worker; it is not guaranteed to work on every restricted network.
- No user accounts or persistent call history.
