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

## Security

Do not put OneSignal REST API keys or other secrets in this repository or frontend code. They will be configured as private environment variables in Render when push sending is implemented.

This initial scaffold exposes only the health endpoint. Authenticated push endpoints and request validation are not implemented yet.
