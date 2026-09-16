// LilysAI Style YouTube Analyzer - options script

import {
  getSettings,
  setSettings,
  getHistory,
  clearHistory,
  getChannels,
  addChannel,
  removeChannel,
  updateChannel,
} from "../utils/storage.js";
import { getUsageStats, checkRateLimit, DEFAULT_DAILY_LIMIT } from "../utils/cost.js";
import { resolveChannelId } from "../utils/channels.js";

// gemini.js가 읽는 것과 동일한 storage 영역/키. API 키는 기기 간 동기화되는
// chrome.storage.sync에 저장하므로, 로컬 설정/히스토리를 다루는
// utils/storage.js와는 별도로 이 파일에서 직접 다룬다.
const API_KEY_STORAGE_KEY = "geminiApiKey";
const DEFAULT_MODEL = "gemini-3.7-flash";
// background.js의 기본값과 동일 (background.js는 다른 파일이 import하는 모듈이 아니므로 값을 복제)
const DEFAULT_CHANNEL_CHECK_INTERVAL_MINUTES = 30;

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

function formatDate(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
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
// 채널 구독 섹션 (새 영상 자동 분석)
// ---------------------------------------------------------------------

const channelInput = document.getElementById("channel-input");
const addChannelBtn = document.getElementById("add-channel-btn");
const channelAddFeedback = document.getElementById("channel-add-feedback");
const channelIntervalInput = document.getElementById("channel-check-interval-input");
const saveChannelIntervalBtn = document.getElementById("save-channel-interval-btn");
const channelIntervalFeedback = document.getElementById("channel-interval-feedback");
const checkChannelsNowBtn = document.getElementById("check-channels-now-btn");
const channelListEl = document.getElementById("channel-list");
const channelListEmptyEl = document.getElementById("channel-list-empty");

async function refreshChannelList() {
  const channels = await getChannels();
  channelListEl.innerHTML = "";
  channelListEmptyEl.classList.toggle("hidden", channels.length > 0);

  for (const channel of channels) {
    const li = document.createElement("li");
    li.className = "channel-item";

    const main = document.createElement("div");
    main.className = "channel-item-main";

    const title = document.createElement("div");
    title.className = "channel-item-title";
    const link = document.createElement("a");
    link.href = channel.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = channel.title ?? channel.channelId;
    title.appendChild(link);

    const meta = document.createElement("div");
    meta.className = "channel-item-meta";
    meta.textContent = channel.lastCheckedAt
      ? `마지막 확인: ${formatDate(channel.lastCheckedAt)}`
      : "아직 확인 전";

    main.append(title, meta);

    const toggleLabel = document.createElement("label");
    toggleLabel.className = "channel-toggle";
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.checked = channel.enabled;
    toggle.addEventListener("change", async () => {
      await updateChannel(channel.channelId, { enabled: toggle.checked });
    });
    toggleLabel.append(toggle, document.createTextNode("자동 분석"));

    const removeBtn = document.createElement("button");
    removeBtn.className = "channel-remove-btn";
    removeBtn.type = "button";
    removeBtn.title = "구독 해제";
    removeBtn.textContent = "🗑";
    removeBtn.addEventListener("click", async () => {
      await removeChannel(channel.channelId);
      await refreshChannelList();
    });

    li.append(main, toggleLabel, removeBtn);
    channelListEl.appendChild(li);
  }
}

async function loadChannelIntervalForm() {
  const settings = await getSettings();
  channelIntervalInput.value = settings.channelCheckIntervalMinutes ?? DEFAULT_CHANNEL_CHECK_INTERVAL_MINUTES;
}

function refreshChannelCheckAlarm() {
  // background.js에 즉시 새 주기로 알람을 다시 등록하도록 알린다.
  chrome.runtime.sendMessage({ action: "refreshChannelCheckAlarm" }, () => {
    void chrome.runtime.lastError;
  });
}

function setupChannelSection() {
  addChannelBtn.addEventListener("click", async () => {
    const value = channelInput.value.trim();
    if (!value) {
      showFeedback(channelAddFeedback, "채널 URL, @핸들 또는 채널 ID를 입력해주세요.", "error");
      return;
    }

    addChannelBtn.disabled = true;
    showFeedback(channelAddFeedback, "채널 정보를 확인하는 중...", null);
    try {
      const resolved = await resolveChannelId(value);
      await addChannel(resolved);
      channelInput.value = "";
      showFeedback(channelAddFeedback, `"${resolved.title}" 채널을 구독했습니다.`, "success");
      await refreshChannelList();
    } catch (error) {
      showFeedback(channelAddFeedback, error.message, "error");
    } finally {
      addChannelBtn.disabled = false;
    }
  });

  saveChannelIntervalBtn.addEventListener("click", async () => {
    const minutes = Number(channelIntervalInput.value);
    if (!Number.isFinite(minutes) || minutes < 5) {
      showFeedback(channelIntervalFeedback, "확인 주기는 5분 이상이어야 합니다.", "error");
      return;
    }

    saveChannelIntervalBtn.disabled = true;
    try {
      await setSettings({ channelCheckIntervalMinutes: minutes });
      refreshChannelCheckAlarm();
      showFeedback(channelIntervalFeedback, "확인 주기가 저장되었습니다.", "success");
    } finally {
      saveChannelIntervalBtn.disabled = false;
    }
  });

  checkChannelsNowBtn.addEventListener("click", () => {
    checkChannelsNowBtn.disabled = true;
    checkChannelsNowBtn.textContent = "확인 중...";

    chrome.runtime.sendMessage({ action: "checkChannelsNow" }, async () => {
      void chrome.runtime.lastError;
      checkChannelsNowBtn.disabled = false;
      checkChannelsNowBtn.textContent = "지금 확인";
      await Promise.all([refreshChannelList(), refreshUsage(), refreshHistoryCount()]);
    });
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
  setupChannelSection();
  setupHistorySection();

  refreshApiKeyStatus();
  loadSettingsForm();
  loadChannelIntervalForm();
  refreshChannelList();
  refreshUsage();
  refreshHistoryCount();
});
