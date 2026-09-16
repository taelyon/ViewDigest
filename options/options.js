// LilysAI Style YouTube Analyzer - options script

import { getSettings, setSettings, getHistory, clearHistory } from "../utils/storage.js";
import { getUsageStats, checkRateLimit, DEFAULT_DAILY_LIMIT } from "../utils/cost.js";

// gemini.js가 읽는 것과 동일한 storage 영역/키. API 키는 기기 간 동기화되는
// chrome.storage.sync에 저장하므로, 로컬 설정/히스토리를 다루는
// utils/storage.js와는 별도로 이 파일에서 직접 다룬다.
const API_KEY_STORAGE_KEY = "geminiApiKey";
const DEFAULT_MODEL = "gemini-3.7-flash";

// ---------------------------------------------------------------------
// 유틸리티
// ---------------------------------------------------------------------

function getSyncApiKey() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(API_KEY_STORAGE_KEY, (result) => {
      resolve(result[API_KEY_STORAGE_KEY]);
    });
  });
}

function setSyncApiKey(key) {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.set({ [API_KEY_STORAGE_KEY]: key }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

function maskApiKey(key) {
  if (!key) return "";
  if (key.length <= 4) return "•".repeat(key.length);
  return `${"•".repeat(Math.max(key.length - 4, 4))}${key.slice(-4)}`;
}

function formatCost(usd) {
  if (typeof usd !== "number" || Number.isNaN(usd)) return "$0.0000";
  return `$${usd.toFixed(4)}`;
}

function showFeedback(el, message, type) {
  el.textContent = message;
  el.className = `feedback${type ? ` ${type}` : ""}`;
}

// ---------------------------------------------------------------------
// API 키 섹션
// ---------------------------------------------------------------------

const apiKeyInput = document.getElementById("api-key-input");
const apiKeyStatus = document.getElementById("api-key-status");
const apiKeyFeedback = document.getElementById("api-key-feedback");
const testResultEl = document.getElementById("test-result");
const toggleVisibilityBtn = document.getElementById("toggle-visibility-btn");
const saveApiKeyBtn = document.getElementById("save-api-key-btn");
const testApiKeyBtn = document.getElementById("test-api-key-btn");

async function refreshApiKeyStatus() {
  const key = await getSyncApiKey();
  apiKeyStatus.textContent = key ? `저장된 키: ${maskApiKey(key)}` : "저장된 API 키가 없습니다.";
}

function setupApiKeySection() {
  toggleVisibilityBtn.addEventListener("click", () => {
    const showing = apiKeyInput.type === "text";
    apiKeyInput.type = showing ? "password" : "text";
    toggleVisibilityBtn.textContent = showing ? "👁" : "🙈";
  });

  saveApiKeyBtn.addEventListener("click", async () => {
    const value = apiKeyInput.value.trim();
    if (!value) {
      showFeedback(apiKeyFeedback, "API 키를 입력해주세요.", "error");
      return;
    }

    saveApiKeyBtn.disabled = true;
    try {
      await setSyncApiKey(value);
      apiKeyInput.value = "";
      showFeedback(apiKeyFeedback, "API 키가 저장되었습니다.", "success");
      await refreshApiKeyStatus();
    } catch (error) {
      showFeedback(apiKeyFeedback, `저장에 실패했습니다: ${error.message}`, "error");
    } finally {
      saveApiKeyBtn.disabled = false;
    }
  });

  testApiKeyBtn.addEventListener("click", async () => {
    const typed = apiKeyInput.value.trim();
    const keyToTest = typed || (await getSyncApiKey());

    if (!keyToTest) {
      showFeedback(testResultEl, "테스트할 API 키가 없습니다. 먼저 입력해주세요.", "error");
      return;
    }

    testApiKeyBtn.disabled = true;
    showFeedback(testResultEl, "확인 중...", null);

    try {
      // 실제 분석 없이 가벼운 모델 목록 조회로 키 유효성만 확인한다 (비용 발생 없음).
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(keyToTest)}`
      );

      if (response.ok) {
        showFeedback(testResultEl, "✅ 유효한 API 키입니다.", "success");
      } else {
        showFeedback(testResultEl, `❌ 유효하지 않은 API 키입니다. (HTTP ${response.status})`, "error");
      }
    } catch {
      showFeedback(testResultEl, "❌ 네트워크 오류로 확인하지 못했습니다.", "error");
    } finally {
      testApiKeyBtn.disabled = false;
    }
  });
}

// ---------------------------------------------------------------------
// 분석 설정 섹션 (모델 / 일일 한도)
// ---------------------------------------------------------------------

const modelSelect = document.getElementById("model-select");
const dailyLimitInput = document.getElementById("daily-limit-input");
const settingsFeedback = document.getElementById("settings-feedback");
const saveSettingsBtn = document.getElementById("save-settings-btn");

async function loadSettingsForm() {
  const settings = await getSettings();
  modelSelect.value = settings.model ?? DEFAULT_MODEL;
  dailyLimitInput.value = settings.dailyLimit ?? DEFAULT_DAILY_LIMIT;
}

function setupSettingsSection() {
  saveSettingsBtn.addEventListener("click", async () => {
    const dailyLimit = Number(dailyLimitInput.value);
    if (!Number.isFinite(dailyLimit) || dailyLimit < 1) {
      showFeedback(settingsFeedback, "일일 최대 분석 횟수는 1 이상의 숫자여야 합니다.", "error");
      return;
    }

    saveSettingsBtn.disabled = true;
    try {
      // setSettings()는 chrome.storage.local에 즉시 반영되며, background.js/cost.js는
      // 매 분석 요청마다 최신 설정을 새로 읽으므로 별도 새로고침 없이 바로 적용된다.
      await setSettings({ model: modelSelect.value, dailyLimit });
      showFeedback(settingsFeedback, "설정이 저장되었습니다.", "success");
      await refreshUsage();
    } finally {
      saveSettingsBtn.disabled = false;
    }
  });
}

// ---------------------------------------------------------------------
// 사용량 요약 섹션
// ---------------------------------------------------------------------

async function refreshUsage() {
  const [stats, rateLimit] = await Promise.all([getUsageStats(), checkRateLimit()]);

  document.getElementById("usage-today-count").textContent = `${stats.today.count}회`;
  document.getElementById("usage-month-count").textContent = `${stats.month.count}회`;
  document.getElementById("usage-today-cost").textContent = formatCost(stats.today.cost);
  document.getElementById("usage-month-cost").textContent = formatCost(stats.month.cost);

  document.getElementById("rate-limit-text").textContent = `${rateLimit.used} / ${rateLimit.limit}`;

  const fill = document.getElementById("rate-limit-fill");
  const percent = rateLimit.limit > 0 ? Math.min((rateLimit.used / rateLimit.limit) * 100, 100) : 100;
  fill.style.width = `${percent}%`;
  fill.classList.toggle("is-full", !rateLimit.allowed);
}

// ---------------------------------------------------------------------
// 히스토리 관리 섹션
// ---------------------------------------------------------------------

const historyCountEl = document.getElementById("history-count");
const historyFeedback = document.getElementById("history-feedback");
const clearHistoryBtn = document.getElementById("clear-history-btn");

async function refreshHistoryCount() {
  const history = await getHistory();
  historyCountEl.textContent = String(history.length);
  return history.length;
}

function setupHistorySection() {
  clearHistoryBtn.addEventListener("click", async () => {
    const count = await refreshHistoryCount();
    if (count === 0) {
      showFeedback(historyFeedback, "삭제할 히스토리가 없습니다.", null);
      return;
    }

    const confirmed = confirm(`저장된 분석 히스토리 ${count}개를 모두 삭제할까요? 되돌릴 수 없습니다.`);
    if (!confirmed) return;

    await clearHistory();
    await refreshHistoryCount();
    showFeedback(historyFeedback, "히스토리를 모두 삭제했습니다.", "success");
  });
}

// ---------------------------------------------------------------------
// 초기화
// ---------------------------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {
  setupApiKeySection();
  setupSettingsSection();
  setupHistorySection();

  refreshApiKeyStatus();
  loadSettingsForm();
  refreshUsage();
  refreshHistoryCount();
});
