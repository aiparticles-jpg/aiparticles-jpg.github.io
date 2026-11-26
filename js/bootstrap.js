const STARTUP_LOCK = "voicelink-app-instance-v1";

function showStartupMessage(title, message, details = "") {
  const panel = document.getElementById("vl-startup-failure");
  if (!panel) return;
  const heading = panel.querySelector("h1");
  const messageNode = document.getElementById("vl-startup-failure-message");
  const detailsNode = document.getElementById("vl-startup-failure-details");
  const reloadButton = panel.querySelector("button");
  if (heading) heading.textContent = title;
  if (messageNode) messageNode.textContent = message;
  if (detailsNode) {
    detailsNode.textContent = details;
    detailsNode.hidden = !details;
  }
  if (reloadButton) reloadButton.hidden = title === "VoiceLink уже открыт";
  panel.hidden = false;
  document.documentElement.dataset.voicelinkBooted = "true";
}

async function startVoiceLink() {
  if (!navigator.locks?.request) {
    showStartupMessage(
      "Не удалось запустить VoiceLink",
      "Этот браузер не поддерживает безопасную блокировку вкладок, необходимую для работы VoiceLink.",
      "Откройте приложение в актуальной версии Chrome или Firefox."
    );
    return;
  }

  try {
    await navigator.locks.request(
      STARTUP_LOCK,
      { mode: "exclusive", ifAvailable: true },
      async lock => {
        if (!lock) {
          showStartupMessage(
            "VoiceLink уже открыт",
            "Приложение VoiceLink уже открыто в другой вкладке браузера. Переключитесь на существующую вкладку, чтобы продолжить работу."
          );
          return;
        }

        await import("./app.js?v=316");
        await new Promise(resolve => window.addEventListener("pagehide", resolve, { once: true }));
      }
    );
  } catch (error) {
    showStartupMessage(
      "Не удалось запустить VoiceLink",
      "Во время запуска произошла ошибка.",
      error?.stack || error?.message || String(error)
    );
  }
}

startVoiceLink();
