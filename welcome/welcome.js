// View Digest - 시작 가이드(설치 직후 열리는 환영 페이지)
//
// 처음 쓰는 사람이 막히는 곳은 API 키다. 예시 리포트로 결과물을 먼저 보여 주고,
// 키 발급 → 붙여넣기·연결 확인 → YouTube에서 분석까지 한 페이지에서 끝내게 한다.

import { t, localizePage } from "../utils/i18n.js";
import { getApiKey, setApiKey, maskApiKey, testApiKey } from "../utils/apikey.js";

localizePage();

const keyInput = document.getElementById("api-key-input");
const keyStatus = document.getElementById("key-status");
const keyFeedback = document.getElementById("key-feedback");
const saveKeyBtn = document.getElementById("save-key-btn");

function showFeedback(message, type) {
  keyFeedback.textContent = message;
  keyFeedback.className = `feedback${type ? ` ${type}` : ""}`;
}

async function refreshKeyStatus() {
  const key = await getApiKey();
  keyStatus.textContent = key ? t("welcomeKeySaved", maskApiKey(key)) : t("welcomeNoKeyYet");
  keyStatus.classList.toggle("saved", Boolean(key));
  // 키가 있으면 1·2단계는 끝난 것으로 표시한다.
  document.getElementById("step-get-key").classList.toggle("done", Boolean(key));
  document.getElementById("step-paste-key").classList.toggle("done", Boolean(key));
}

/**
 * 붙여넣은 키를 확인한 뒤 저장한다. Google이 키를 거절하면(잘못 복사 등) 저장하지 않는다.
 * 네트워크 문제로 확인하지 못했으면 일단 저장한다(나중에 분석할 때 다시 확인된다).
 * 입력이 비어 있으면 이미 저장된 키를 확인만 한다.
 */
async function saveAndTest() {
  const typed = keyInput.value.trim();
  const key = typed || (await getApiKey());
  if (!key) {
    showFeedback(t("welcomeEnterKey"), "error");
    return;
  }

  saveKeyBtn.disabled = true;
  showFeedback(t("welcomeChecking"), null);
  try {
    const result = await testApiKey(key);
    if (!result.ok && result.status) {
      showFeedback(t("welcomeKeyInvalid", result.status), "error");
      return;
    }
    if (typed) {
      await setApiKey(typed);
      keyInput.value = "";
    }
    showFeedback(result.ok ? t("welcomeKeyOk") : t("welcomeKeyNetwork"), result.ok ? "success" : "error");
    await refreshKeyStatus();
  } finally {
    saveKeyBtn.disabled = false;
  }
}

document.getElementById("sample-link").href = chrome.runtime.getURL("results/results.html?sample=1");
document.getElementById("open-options-btn").addEventListener("click", () => chrome.runtime.openOptionsPage());
saveKeyBtn.addEventListener("click", saveAndTest);
keyInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") saveAndTest();
});
refreshKeyStatus();
