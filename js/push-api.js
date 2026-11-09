import { getCurrentSignalingIdentity } from "./ntfy-identity.js";
import { getContact } from "./local-store.js";

const BACKEND_URL = "https://signal-backend-9tai.onrender.com";
const encoder = new TextEncoder();

function toBase64Url(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

export async function sendPushEventToContact(userId, event, callId, expiresAt, senderName) {
  const contact = await getContact(userId);
  if (!contact?.push_subscription_id) {
    throw new Error("У контакта нет OneSignal Subscription ID. Попросите его обновить приглашение.");
  }

  const identity = await getCurrentSignalingIdentity();
  const request = {
    v: 1,
    user_id: identity.user_id,
    public_key: identity.public_key,
    timestamp: Date.now(),
    nonce: toBase64Url(crypto.getRandomValues(new Uint8Array(16))),
    event,
    call_id: callId,
    recipient_subscription_id: contact.push_subscription_id,
    expires_at: expiresAt
  };
  const safeSenderName = typeof senderName === "string" ? senderName.trim().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 60) : "";
  if (safeSenderName) request.sender_name = safeSenderName;
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    identity.privateKey,
    encoder.encode(JSON.stringify(request))
  );
  request.signature = toBase64Url(signature);

  const response = await fetch(BACKEND_URL + "/v1/push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    cache: "no-store"
  });
  let result = {};
  try { result = await response.json(); } catch {}
  if (!response.ok || result.ok !== true) {
    const messages = {
      invalid_request: "Backend отклонил подписанный запрос.",
      replayed_request: "Повторный запрос был отклонён.",
      rate_limited: "Слишком много запросов. Попробуйте позже.",
      push_configuration_error: "Ошибка конфигурации OneSignal на сервере.",
      push_unavailable: "Сервис push-уведомлений временно недоступен.",
      invalid_push_target: "OneSignal не принял Subscription ID контакта."
    };
    throw new Error(messages[result.error] || "Не удалось отправить push-уведомление (HTTP " + response.status + ").");
  }
  return result;
}
