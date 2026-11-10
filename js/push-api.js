import { getCurrentSignalingIdentity } from "./ntfy-identity.js";
import { getContact } from "./local-store.js";

const BACKEND_URL = "https://signal-backend-9tai.onrender.com";
export async function sendPushEventToContact(userId, event, callId, expiresAt) {
  const contact = await getContact(userId);
  if (!contact?.push_subscription_id) {
    throw new Error("У контакта нет OneSignal Subscription ID. Попросите его обновить приглашение.");
  }

  const identity = await getCurrentSignalingIdentity();
  const request = {
    v: 1,
    user_id: identity.user_id,
    timestamp: Date.now(),
    event,
    call_id: callId,
    recipient_subscription_id: contact.push_subscription_id,
    expires_at: expiresAt
  };
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
      invalid_request: "Backend отклонил запрос.",
      rate_limited: "Слишком много запросов. Попробуйте позже.",
      push_configuration_error: "Ошибка конфигурации OneSignal на сервере.",
      push_unavailable: "Сервис push-уведомлений временно недоступен.",
      invalid_push_target: "OneSignal не принял Subscription ID контакта."
    };
    throw new Error(messages[result.error] || "Не удалось отправить push-уведомление (HTTP " + response.status + ").");
  }
  return result;
}
