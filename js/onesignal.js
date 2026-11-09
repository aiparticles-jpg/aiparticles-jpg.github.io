const APP_ID = "6eba7e51-55f4-4230-b78b-70c6dd293054";
const SDK_URL = "https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js";
let initialization;
let sdkLoadPromise;

function reportStatus(status, text) {
  window.dispatchEvent(new CustomEvent("voicelink:onesignal-status", {
    detail: { status, text }
  }));
}

function loadOneSignalSdk() {
  if (window.OneSignal) return Promise.resolve();
  if (sdkLoadPromise) return sdkLoadPromise;

  sdkLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SDK_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Не удалось загрузить OneSignal SDK с cdn.onesignal.com."));
    document.head.appendChild(script);
  });
  return sdkLoadPromise;
}

export function initializeOneSignal() {
  if (initialization) return initialization;
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    reportStatus("error", "Недоступен: браузер не поддерживает Web Push");
    return Promise.reject(new Error("Этот браузер не поддерживает Web Push."));
  }

  reportStatus("loading", "Загружается…");
  const task = new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      reportStatus("error", "Недоступен: превышено время ожидания SDK");
      reject(new Error("OneSignal SDK не загрузился за 20 секунд. Проверьте соединение и настройки Web Push."));
    }, 20000);

    window.OneSignalDeferred = window.OneSignalDeferred || [];
    window.OneSignalDeferred.push(async OneSignal => {
      if (settled) return;
      try {
        await OneSignal.init({
          appId: APP_ID,
          autoRegister: false,
          serviceWorkerPath: "/OneSignalSDKWorker.js",
          serviceWorkerParam: { scope: "/" }
        });
        OneSignal.Notifications.addEventListener("foregroundWillDisplay", event => {
          const data = event.notification?.additionalData || {};
          if (data.event === "new_message" && window.voicelinkIsReadingChat?.(data.sender_id)) {
            event.preventDefault();
          }
        });
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reportStatus("ready", "Инициализирован");
        resolve(OneSignal);
      } catch (error) {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reportStatus("error", "Недоступен: ошибка инициализации");
        reject(error);
      }
    });

    loadOneSignalSdk().catch(error => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reportStatus("error", "Недоступен: не удалось загрузить SDK");
      reject(error);
    });
  });

  initialization = task.catch(error => {
    initialization = null;
    throw error;
  });
  return initialization;
}

export async function enableOneSignalPush() {
  const OneSignal = await initializeOneSignal();

  if (!("Notification" in window)) {
    throw new Error("Этот браузер не поддерживает разрешения на уведомления.");
  }

  let permission = Notification.permission;
  if (permission === "denied") {
    throw new Error("Уведомления для VoiceLink запрещены в настройках браузера. Разрешите уведомления для этого сайта и повторите попытку.");
  }

  if (permission === "default") {
    await OneSignal.Notifications.requestPermission();
    permission = Notification.permission;
  }

  if (permission !== "granted") {
    throw new Error("Для создания приглашения необходимо разрешить push-уведомления.");
  }

  await OneSignal.User.PushSubscription.optIn();

  // Subscription ID can arrive asynchronously after permission and opt-in.
  for (let attempt = 0; attempt < 60; attempt++) {
    const id = OneSignal.User.PushSubscription.id;
    if (typeof id === "string" && id.trim()) return id;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error("Разрешение получено, но OneSignal не выдал Subscription ID. Проверьте настройки Web Push и попробуйте ещё раз.");
}
