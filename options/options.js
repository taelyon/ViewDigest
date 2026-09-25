// ViewDigest - options script

import {
  getSettings,
  setSettings,
  getChannels,
  addChannel,
  removeChannel,
  updateChannel,
} from "../utils/storage.js";
import { DEFAULT_DAILY_LIMIT } from "../utils/cost.js";
import { resolveChannelId } from "../utils/channels.js";
import { t, localizePage, formatDateTime } from "../utils/i18n.js";

localizePage();

// 설치된 버전. manifest.json에서 읽으므로 버전을 올리면 따로 고칠 필요가 없다.
document.getElementById("app-version").textContent = `v${chrome.runtime.getManifest().version}`;

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
  apiKeyStatus.textContent = key ? t("optionsSavedKey", maskApiKey(key)) : t("optionsNoSavedKey");
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
      showFeedback(apiKeyFeedback, t("optionsEnterApiKey"), "error");
      return;
    }

    saveApiKeyBtn.disabled = true;
    try {
      await setSyncApiKey(value);
      apiKeyInput.value = "";
      showFeedback(apiKeyFeedback, t("optionsApiKeySaved"), "success");
      await refreshApiKeyStatus();
    } catch (error) {
      showFeedback(apiKeyFeedback, t("optionsSaveFailed", error.message), "error");
    } finally {
      saveApiKeyBtn.disabled = false;
    }
  });

  testApiKeyBtn.addEventListener("click", async () => {
    const typed = apiKeyInput.value.trim();
    const keyToTest = typed || (await getSyncApiKey());

    if (!keyToTest) {
      showFeedback(testResultEl, t("optionsNoKeyToTest"), "error");
      return;
    }

    testApiKeyBtn.disabled = true;
    showFeedback(testResultEl, t("optionsChecking"), null);

    try {
      // 실제 분석 없이 가벼운 모델 목록 조회로 키 유효성만 확인한다 (비용 발생 없음).
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(keyToTest)}`
      );

      if (response.ok) {
        showFeedback(testResultEl, t("optionsKeyValid"), "success");
      } else {
        showFeedback(testResultEl, t("optionsKeyInvalid", response.status), "error");
      }
    } catch {
      showFeedback(testResultEl, t("optionsKeyNetworkError"), "error");
    } finally {
      testApiKeyBtn.disabled = false;
    }
  });
}

// ---------------------------------------------------------------------
// 분석 설정 섹션 (모델 / 리포트 언어 / 일일 한도)
// ---------------------------------------------------------------------

const modelSelect = document.getElementById("model-select");
const reportLanguageSelect = document.getElementById("report-language-select");
const dailyLimitInput = document.getElementById("daily-limit-input");
const settingsFeedback = document.getElementById("settings-feedback");
const saveSettingsBtn = document.getElementById("save-settings-btn");

async function loadSettingsForm() {
  const settings = await getSettings();
  modelSelect.value = settings.model ?? DEFAULT_MODEL;
  reportLanguageSelect.value = settings.reportLanguage ?? "auto";
  dailyLimitInput.value = settings.dailyLimit ?? DEFAULT_DAILY_LIMIT;
}

function setupSettingsSection() {
  saveSettingsBtn.addEventListener("click", async () => {
    const dailyLimit = Number(dailyLimitInput.value);
    if (!Number.isFinite(dailyLimit) || dailyLimit < 1) {
      showFeedback(settingsFeedback, t("optionsDailyLimitInvalid"), "error");
      return;
    }

    saveSettingsBtn.disabled = true;
    try {
      // setSettings()는 chrome.storage.local에 즉시 반영되며, background.js/cost.js는
      // 매 분석 요청마다 최신 설정을 새로 읽으므로 별도 새로고침 없이 바로 적용된다.
      await setSettings({
        model: modelSelect.value,
        reportLanguage: reportLanguageSelect.value,
        dailyLimit,
      });
      showFeedback(settingsFeedback, t("optionsSettingsSaved"), "success");
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
const channelNextCheckEl = document.getElementById("channel-next-check");
const CHANNEL_CHECK_ALARM_NAME = "checkChannels"; // background.js와 동일

/**
 * 채널 항목 아래 줄. 확인에 실패했으면 그 시각과 사유(와 마지막 성공 시각)를,
 * 성공했으면 마지막 확인 시각을 보여준다. RSS 대신 채널 페이지로 읽었으면 덧붙인다.
 * (예전 버전은 성공했을 때만 lastCheckedAt을 남겼으므로 lastSuccessAt이 없을 수 있다.)
 */
function renderChannelMeta(meta, channel) {
  if (!channel.lastCheckedAt) {
    meta.textContent = t("optionsNotCheckedYet");
    return;
  }

  if (channel.lastCheckError) {
    const failed = document.createElement("div");
    failed.className = "channel-item-error";
    failed.textContent = t("optionsCheckFailed", formatDateTime(channel.lastCheckedAt), channel.lastCheckError);
    meta.appendChild(failed);
    if (channel.lastSuccessAt) {
      const lastSuccess = document.createElement("div");
      lastSuccess.textContent = t("optionsLastSuccess", formatDateTime(channel.lastSuccessAt));
      meta.appendChild(lastSuccess);
    }
    return;
  }

  let text = t("optionsLastChecked", formatDateTime(channel.lastCheckedAt));
  if (channel.lastCheckSource === "page") text += ` · ${t("optionsReadFromPage")}`;
  meta.textContent = text;
}

// 이보다 오래된 실패 기록은 화면에 보이지 않게 한다(저장은 채널당 최근 3건까지만).
const FAILURE_VISIBLE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 채널 자동 분석이 건너뛴 영상과 그 사유. 알림을 놓쳐도 여기서 확인할 수 있다.
 */
function renderChannelFailures(channel) {
  const cutoff = Date.now() - FAILURE_VISIBLE_MS;
  const failures = (channel.recentFailures ?? []).filter((f) => Date.parse(f.at) >= cutoff);
  if (failures.length === 0) return null;

  const list = document.createElement("ul");
  list.className = "channel-failures";
  for (const failure of failures) {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = failure.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = failure.title;
    item.append(
      `${t("optionsRecentFailure", formatDateTime(failure.at))}: `,
      link,
      ` — ${failure.reason}`
    );
    list.appendChild(item);
  }
  return list;
}

async function refreshNextCheck() {
  const alarm = await chrome.alarms.get(CHANNEL_CHECK_ALARM_NAME);
  const channels = await getChannels();
  const show = Boolean(alarm) && channels.some((c) => c.enabled);
  channelNextCheckEl.classList.toggle("hidden", !show);
  if (show) {
    channelNextCheckEl.textContent = t("optionsNextCheck", formatDateTime(new Date(alarm.scheduledTime).toISOString()));
  }
}

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
    renderChannelMeta(meta, channel);

    main.append(title, meta);
    const failures = renderChannelFailures(channel);
    if (failures) main.appendChild(failures);

    const toggleLabel = document.createElement("label");
    toggleLabel.className = "channel-toggle";
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.checked = channel.enabled;
    toggle.addEventListener("change", async () => {
      await updateChannel(channel.channelId, { enabled: toggle.checked });
    });
    toggleLabel.append(toggle, document.createTextNode(t("optionsAutoAnalyze")));

    const removeBtn = document.createElement("button");
    removeBtn.className = "channel-remove-btn";
    removeBtn.type = "button";
    removeBtn.title = t("optionsUnsubscribe");
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
    refreshNextCheck();
  });
}

// 백그라운드의 자동 확인이 채널 상태를 바꾸면, 이 페이지가 열려 있어도 바로 반영한다.
// (예전에는 페이지를 연 순간의 값이 그대로 남아 확인이 멈춘 것처럼 보였다.)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.subscribedChannels) {
    refreshChannelList();
    refreshNextCheck();
  }
});

function setupChannelSection() {
  addChannelBtn.addEventListener("click", async () => {
    const value = channelInput.value.trim();
    if (!value) {
      showFeedback(channelAddFeedback, t("optionsEnterChannel"), "error");
      return;
    }

    addChannelBtn.disabled = true;
    showFeedback(channelAddFeedback, t("optionsResolvingChannel"), null);
    try {
      const resolved = await resolveChannelId(value);
      await addChannel(resolved);
      channelInput.value = "";
      showFeedback(channelAddFeedback, t("optionsChannelSubscribed", resolved.title), "success");
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
      showFeedback(channelIntervalFeedback, t("optionsIntervalInvalid"), "error");
      return;
    }

    saveChannelIntervalBtn.disabled = true;
    try {
      await setSettings({ channelCheckIntervalMinutes: minutes });
      refreshChannelCheckAlarm();
      showFeedback(channelIntervalFeedback, t("optionsIntervalSaved"), "success");
    } finally {
      saveChannelIntervalBtn.disabled = false;
    }
  });

  checkChannelsNowBtn.addEventListener("click", () => {
    checkChannelsNowBtn.disabled = true;
    checkChannelsNowBtn.textContent = t("optionsChecking");

    chrome.runtime.sendMessage({ action: "checkChannelsNow" }, async () => {
      void chrome.runtime.lastError;
      checkChannelsNowBtn.disabled = false;
      checkChannelsNowBtn.textContent = t("optionsCheckNow");
      await refreshChannelList();
    });
  });
}

// ---------------------------------------------------------------------
// 초기화
// ---------------------------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {
  setupApiKeySection();
  setupSettingsSection();
  setupChannelSection();

  refreshApiKeyStatus();
  loadSettingsForm();
  loadChannelIntervalForm();
  refreshChannelList();
  refreshNextCheck();
});
