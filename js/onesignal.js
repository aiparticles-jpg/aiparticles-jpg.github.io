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
  await OneSignal.User.PushSubscription.optIn();

  // Subscription ID can arrive asynchronously after the permission prompt.
  for (let attempt = 0; attempt < 60; attempt++) {
    const id = OneSignal.User.PushSubscription.id;
    if (typeof id === "string" && id.trim()) return id;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error("OneSignal не выдал Subscription ID. Проверьте разрешение на уведомления и настройки Web Push в OneSignal.");
}
