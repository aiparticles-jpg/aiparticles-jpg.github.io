import { getCurrentSignalingIdentity } from "./ntfy-identity.js";
import { getContact } from "./local-store.js";

const BACKEND_URL = "https://signal-backend-9tai.onrender.com";
export async function sendPushEventToContact(userId, event, callId, expiresAt, onDiagnostic) {
  const startedAt = performance.now();
  const report = message => { try { onDiagnostic?.("[push] " + message); } catch {} };
  const elapsed = () => Math.round(performance.now() - startedAt);
  report("START event=" + event + "; backend=" + new URL(BACKEND_URL).host);
  try {
    const contact = await getContact(userId);
    if (!contact?.push_subscription_id) {
      report("NO_RECIPIENT_SUBSCRIPTION_ID event=" + event + "; elapsed=" + elapsed() + "ms");
      throw new Error("У контакта нет OneSignal Subscription ID. Попросите его обновить приглашение.");
    }
    const subscriptionId = String(contact.push_subscription_id);
    report("TARGET event=" + event + "; recipient_subscription_suffix=…" + subscriptionId.slice(-8));
    const identity = await getCurrentSignalingIdentity();
    const request = { v: 1, user_id: identity.user_id, timestamp: Date.now(), event, call_id: callId, recipient_subscription_id: subscriptionId, expires_at: expiresAt };
    report("FETCH_START event=" + event + "; method=POST; path=/v1/push");
    let response;
    try {
      response = await fetch(BACKEND_URL + "/v1/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request), cache: "no-store" });
    } catch (error) {
      report("FETCH_FAILED event=" + event + "; elapsed=" + elapsed() + "ms; name=" + (error?.name || "Error") + "; message=" + (error?.message || String(error)));
      throw error;
    }
    let result = {};
    try { result = await response.json(); } catch {}
    report("HTTP_RESPONSE event=" + event + "; status=" + response.status + "; ok=" + response.ok + "; accepted=" + (result.accepted === true) + "; duplicate=" + (result.duplicate === true) + "; error=" + (result.error || "none") + "; elapsed=" + elapsed() + "ms");
    if (!response.ok || result.ok !== true) {
      const messages = { invalid_request: "Backend отклонил запрос.", rate_limited: "Слишком много запросов. Попробуйте позже.", push_configuration_error: "Ошибка конфигурации OneSignal на сервере.", push_unavailable: "Сервис push-уведомлений временно недоступен.", invalid_push_target: "OneSignal не принял Subscription ID контакта." };
      throw new Error(messages[result.error] || "Не удалось отправить push-уведомление (HTTP " + response.status + ").");
    }
    report("ACCEPTED event=" + event + "; elapsed=" + elapsed() + "ms");
    return result;
  } catch (error) {
    report("FAILED event=" + event + "; elapsed=" + elapsed() + "ms; name=" + (error?.name || "Error") + "; message=" + (error?.message || String(error)));
    throw error;
  }
}
