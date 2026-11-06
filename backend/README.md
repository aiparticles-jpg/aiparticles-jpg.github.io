# VoiceLink backend

Minimal Node.js/Express service for VoiceLink.

## Local run

Requires Node.js 20 or newer.

```bash
npm install
npm start
```

The service listens on `PORT` (default: `3000`).

Health check:

```text
GET /health
```

Expected response:

```json
{
  "ok": true,
  "service": "voicelink-backend"
}
```

## Deploy on Render

Create a **Web Service** from the existing repository:

- Repository: `aiparticles-jpg/aiparticles-jpg.github.io`
- Root Directory: `backend`
- Runtime: Node
- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/health`

Render provides the `PORT` environment variable. The server binds to `0.0.0.0`.

## Push API

The frontend submits signed push events to:

```text
POST /v1/push
```

Allowed events: `incoming_call`, `call_cancelled`, `call_ignored`, and `call_ended`.

Each request includes the sender's public P-256 key, its SHA-256 `user_id`, timestamp, random nonce, event, UUID call ID, recipient OneSignal Subscription ID, expiry, and ECDSA signature. The signature covers all request fields except the signature itself. The backend verifies the key fingerprint, signature, timestamp, nonce, event, and request limits before calling OneSignal.

The backend does not store contacts or call history. Replay protection, rate limits, and event idempotency are held temporarily in memory and reset when the service restarts. Push submission is best-effort and does not replace ntfy signaling or WebRTC.

## Security

Set `ONESIGNAL_REST_API_KEY` as a private environment variable in Render. Never put it in this repository or frontend code. The OneSignal App ID is public and is embedded in the backend.

The API accepts browser requests only from `https://aiparticles-jpg.github.io`. Do not log API keys, signatures, Subscription IDs, user IDs, request bodies, or OneSignal response bodies.
