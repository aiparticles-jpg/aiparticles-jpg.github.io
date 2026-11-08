const APP_ID = "6eba7e51-55f4-4230-b78b-70c6dd293054";
let initialization;

export function initializeOneSignal() {
  if (initialization) return initialization;
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return Promise.reject(new Error("Этот браузер не поддерживает Web Push."));
  }

  initialization = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("OneSignal SDK не загрузился. Проверьте соединение и настройки Web Push.")), 20000);
    window.OneSignalDeferred = window.OneSignalDeferred || [];
    window.OneSignalDeferred.push(async OneSignal => {
      try {
        await OneSignal.init({
          appId: APP_ID,
          autoRegister: false,
          serviceWorkerPath: "/OneSignalSDKWorker.js",
          serviceWorkerParam: { scope: "/" }
        });
        clearTimeout(timeout);
        resolve(OneSignal);
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
      }
    });
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
