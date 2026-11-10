const express = require("express");

const app = express();
const port = Number(process.env.PORT) || 3000;
const APP_ID = "6eba7e51-55f4-4230-b78b-70c6dd293054";
const ALLOWED_ORIGIN = "https://aiparticles-jpg.github.io";
const ALLOWED_EVENTS = new Set([
  "incoming_call",
  "new_message",
  "contact_request",
  "call_cancelled",
  "call_ignored",
  "call_ended"
]);
const WINDOW_MS = 60_000;
const IDEMPOTENCY_TTL_MS = 120_000;
const idempotencyCache = new Map();
const rateCache = new Map();

app.disable("x-powered-by");
app.use(express.json({ limit: "16kb", strict: true }));

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin === ALLOWED_ORIGIN) {
    res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
  if (req.method === "OPTIONS") return res.sendStatus(origin === ALLOWED_ORIGIN ? 204 : 403);
  next();
});

function cleanupCache(cache, now) {
  for (const [key, entry] of cache) {
    if ((entry.expiresAt ?? entry.resetAt ?? 0) <= now) cache.delete(key);
  }
}

function rateLimit(key, limit, windowMs, now) {
  let entry = rateCache.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + windowMs };
    rateCache.set(key, entry);
  }
  entry.count += 1;
  return entry.count <= limit;
}

function isUuid(value) {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validateRequest(body, now) {
  if (!body || typeof body !== "object" || Array.isArray(body) || body.v !== 1) return null;
  const { user_id, timestamp, event, call_id, recipient_subscription_id, expires_at, sender_name } = body;
  if (typeof user_id !== "string" || !/^[a-f0-9]{64}$/.test(user_id)) return null;
  if (!Number.isSafeInteger(timestamp) || Math.abs(now - timestamp) > WINDOW_MS) return null;
  if (!ALLOWED_EVENTS.has(event)) return null;
  if (!isUuid(call_id)) return null;
  if (typeof recipient_subscription_id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(recipient_subscription_id)) return null;
  if (!Number.isSafeInteger(expires_at)) return null;
  if (sender_name !== undefined && (typeof sender_name !== "string" || sender_name.length > 60 || sender_name.trim() !== sender_name || /[\\u0000-\\u001f\\u007f]/.test(sender_name))) return null;

  return { user_id, event, call_id, recipient_subscription_id, expires_at };
}

function notificationText(event) {
  switch (event.event) {
    case "incoming_call": return "Входящий звонок в VoiceLink.";
    case "new_message": return "Новое сообщение в VoiceLink.";
    case "contact_request": return "Пользователь хочет добавить вас в контакты VoiceLink.";
    case "call_cancelled": return "Входящий вызов отменён.";
    case "call_ignored": return "Вызов отклонён.";
    case "call_ended": return "Звонок завершён.";
    default: return "Новое событие VoiceLink.";
  }
}

async function submitOneSignal(event) {
  const apiKey = process.env.ONESIGNAL_REST_API_KEY;
  if (!apiKey) {
    const error = new Error("OneSignal is not configured");
    error.status = 503;
    error.category = "configuration";
    throw error;
  }

  const response = await fetch("https://api.onesignal.com/notifications", {
    method: "POST",
    headers: {
      "Authorization": "Key " + apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      app_id: APP_ID,
      target_channel: "push",
      include_subscription_ids: [event.recipient_subscription_id],
      headings: { en: "VoiceLink" },
      contents: { en: notificationText(event) },
      data: {
        event: event.event,
        sender_id: event.user_id,
        call_id: event.call_id,
        expires_at: event.expires_at
      }
    })
  });

  if (response.ok) return;
  const error = new Error("OneSignal request failed");
  error.status = response.status;
  error.category = response.status === 401 || response.status === 403
    ? "authorization"
    : response.status === 429
      ? "rate_limit"
      : response.status >= 500
        ? "provider_unavailable"
        : "provider_rejected";
  throw error;
}

async function submitWithRetry(event) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await submitOneSignal(event);
      return;
    } catch (error) {
      const retryable = error.status === 429 || error.status >= 500;
      if (!retryable || attempt === 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
}

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true, service: "voicelink-backend" });
});

app.post("/v1/push", async (req, res) => {
  const now = Date.now();
  cleanupCache(idempotencyCache, now);
  cleanupCache(rateCache, now);

  const event = validateRequest(req.body, now);
  if (!event) return res.status(400).json({ ok: false, error: "invalid_request" });

  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const ipLimit = event.event === "new_message" ? 60 : 10;
  const userLimit = event.event === "new_message" ? 30 : 5;
  if (!rateLimit("ip:" + ip, ipLimit, 60_000, now) ||
      !rateLimit("user:" + event.user_id, userLimit, 60_000, now)) {
    return res.status(429).json({ ok: false, error: "rate_limited" });
  }


  const idempotencyKey = event.call_id + ":" + event.event;
  if (idempotencyCache.has(idempotencyKey)) {
    return res.status(200).json({ ok: true, duplicate: true });
  }

  try {
    await submitWithRetry(event);
    idempotencyCache.set(idempotencyKey, { expiresAt: now + IDEMPOTENCY_TTL_MS });
    return res.status(200).json({ ok: true, accepted: true });
  } catch (error) {
    const status = error.status === 400 ? 400 :
      error.status === 401 || error.status === 403 ? 502 :
      error.status === 429 ? 503 :
      error.status >= 500 ? 503 : 502;
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      status: error.status || null,
      event_type: event.event,
      category: error.category || "internal"
    }));
    return res.status(status).json({
      ok: false,
      error: status === 400 ? "invalid_push_target" :
        error.category === "authorization" ? "push_configuration_error" :
        "push_unavailable"
    });
  }
});

app.listen(port, "0.0.0.0", () => {
  console.log(`VoiceLink backend listening on port ${port}`);
});
