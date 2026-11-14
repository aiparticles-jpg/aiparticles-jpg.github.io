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

// Return an already available subscription without prompting the user.
// Contact exchange itself is transported by ntfy and must work without Web Push.
export async function getOptionalOneSignalSubscriptionId() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) ||
      !("Notification" in window) || Notification.permission !== "granted") {
    return null;
  }
  try {
    const OneSignal = await initializeOneSignal();
    // The SDK may initialize before its existing browser subscription has
    // finished loading. Wait for the ID instead of silently omitting it.
    for (let attempt = 0; attempt < 60; attempt++) {
      const id = OneSignal.User?.PushSubscription?.id;
      if (typeof id === "string" && id.trim()) return id;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    return null;
  } catch {
    return null;
  }
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

export async function getOneSignalPushDiagnostics() {
  const permission = "Notification" in window ? Notification.permission : "unsupported";
  const result = {
    permission,
    supported: "serviceWorker" in navigator && "PushManager" in window,
    subscriptionIdSuffix: null,
    optedIn: null,
    idAvailable: false
  };

  try {
    const OneSignal = await initializeOneSignal();
    const subscription = OneSignal.User?.PushSubscription;
    for (let attempt = 0; attempt < 20; attempt++) {
      const id = subscription?.id;
      if (typeof id === "string" && id.trim()) {
        result.idAvailable = true;
        result.subscriptionIdSuffix = id.slice(-8);
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (typeof subscription?.optedIn === "boolean") {
      result.optedIn = subscription.optedIn;
    }
  } catch (error) {
    result.error = error?.message || String(error);
  }

  return result;
}
