// ViewDigest - popup script
//
// 분석은 항상 results/results.html을 새 탭으로 열어 처리한다(스트리밍 표시).
// 팝업 자체는 분석 결과를 렌더링하지 않고, 분석 시작 버튼 + 히스토리 + 사용량만 보여준다.

import { getHistory, deleteAnalysis, clearHistory } from "../utils/storage.js";
import { getUsageStats, checkRateLimit } from "../utils/cost.js";
import { t, localizePage, formatDateTime } from "../utils/i18n.js";

localizePage();

const YOUTUBE_WATCH_RE = /^https:\/\/(www\.)?youtube\.com\/watch\?.*v=/;

// ---------------------------------------------------------------------
// 탭 전환 (히스토리 / 사용량)
// ---------------------------------------------------------------------

function switchTab(tabName) {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tabName);
  });
  document.querySelectorAll(".panel").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.panel === tabName);
  });
}

function setupTabs() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });
}

function formatCost(usd) {
  if (typeof usd !== "number" || Number.isNaN(usd)) return "$0.0000";
  return `$${usd.toFixed(4)}`;
}

// ---------------------------------------------------------------------
// 분석 시작 버튼: 항상 새 탭(results.html)에서 스트리밍으로 진행한다
// ---------------------------------------------------------------------

function cleanYoutubeTitle(rawTitle) {
  if (!rawTitle) return null;
  return rawTitle.replace(/\s*-\s*YouTube\s*$/, "").trim() || null;
}

function openResultsTab(params) {
  const url = new URL(chrome.runtime.getURL("results/results.html"));
  Object.entries(params).forEach(([key, value]) => {
    if (value) url.searchParams.set(key, value);
  });
  chrome.tabs.create({ url: url.toString() });
}

async function getActiveYoutubeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !YOUTUBE_WATCH_RE.test(tab.url)) return null;
  return tab;
}

async function initAnalyzeButton() {
  const tab = await getActiveYoutubeTab();
  const startBtn = document.getElementById("start-analyze-btn");
  const hint = document.getElementById("idle-hint");

  startBtn.disabled = !tab;
  hint.textContent = tab ? "" : t("popupWatchPageOnly");
}

function setupAnalyzeButton() {
  document.getElementById("start-analyze-btn").addEventListener("click", async () => {
    const tab = await getActiveYoutubeTab();
    if (!tab?.url) return;

    openResultsTab({ url: tab.url, title: cleanYoutubeTitle(tab.title) });
    window.close(); // 결과는 새 탭이 보여주므로 팝업은 닫아 자연스럽게 정리한다
  });
}

// ---------------------------------------------------------------------
// 히스토리 탭
// ---------------------------------------------------------------------

async function refreshHistory() {
  const history = await getHistory();
  const list = document.getElementById("history-list");
  const empty = document.getElementById("history-empty");

  list.innerHTML = "";
  empty.classList.toggle("hidden", history.length > 0);
  document.querySelector(".history-header").classList.toggle("hidden", history.length === 0);

  for (const entry of history) {
    const li = document.createElement("li");
    li.className = "history-item";

    const main = document.createElement("div");
    main.className = "history-item-main";

    const title = document.createElement("div");
    title.className = "history-item-title";
    title.textContent = entry.title ?? t("untitled");

    const meta = document.createElement("div");
    meta.className = "history-item-meta";
    meta.innerHTML = `<span>${formatDateTime(entry.createdAt)}</span><span class="model-badge">${
      entry.model ?? "-"
    }</span>`;

    main.append(title, meta);

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "history-delete-btn";
    deleteBtn.type = "button";
    deleteBtn.title = t("popupDelete");
    deleteBtn.textContent = "🗑";
    deleteBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await deleteAnalysis(entry.id);
      refreshHistory();
    });

    main.addEventListener("click", () => {
      openResultsTab({ entryId: entry.id });
    });

    li.append(main, deleteBtn);
    list.appendChild(li);
  }
}

// 팝업(작은 브라우저 액션 창)에서는 window.confirm()이 포커스를 잃으며 팝업 자체가
// 닫혀버려 제대로 동작하지 않는다. 대신 첫 클릭에 버튼 텍스트를 확인 문구로 바꿔
// 잠깐 대기하고, 그 상태에서 한 번 더 클릭해야 실제로 삭제되는 2단계 확인 방식을 쓴다.
function setupClearHistoryButton() {
  const btn = document.getElementById("clear-history-btn");
  const originalLabel = btn.textContent;
  let armed = false;
  let resetTimer = null;

  function reset() {
    armed = false;
    clearTimeout(resetTimer);
    btn.textContent = originalLabel;
  }

  btn.addEventListener("click", async () => {
    if (!armed) {
      armed = true;
      btn.textContent = t("popupClearHistoryConfirm");
      resetTimer = setTimeout(reset, 3000);
      return;
    }

    reset();
    await clearHistory();
    await refreshHistory();
  });
}

// ---------------------------------------------------------------------
// 사용량 탭
// ---------------------------------------------------------------------

async function refreshUsage() {
  const [stats, rateLimit] = await Promise.all([getUsageStats(), checkRateLimit()]);

  document.getElementById("usage-today-count").textContent = t("popupCount", stats.today.count);
  document.getElementById("usage-month-count").textContent = t("popupCount", stats.month.count);
  document.getElementById("usage-today-cost").textContent = formatCost(stats.today.cost);
  document.getElementById("usage-month-cost").textContent = formatCost(stats.month.cost);

  document.getElementById("rate-limit-text").textContent = `${rateLimit.used} / ${rateLimit.limit}`;

  const fill = document.getElementById("rate-limit-fill");
  const percent = rateLimit.limit > 0 ? Math.min((rateLimit.used / rateLimit.limit) * 100, 100) : 100;
  fill.style.width = `${percent}%`;
  fill.classList.toggle("is-full", !rateLimit.allowed);

  const status = document.getElementById("rate-limit-status");
  status.textContent = rateLimit.allowed
    ? t("popupRemaining", rateLimit.remaining)
    : t("popupLimitReached");
}

// ---------------------------------------------------------------------
// 백그라운드에서 오는 브로드캐스트 (채널 자동 분석, results 탭 완료 등)
// ---------------------------------------------------------------------

function setupBackgroundListener() {
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.action === "analysisComplete") {
      refreshHistory();
      refreshUsage();
    }
  });
}

// ---------------------------------------------------------------------
// 초기화
// ---------------------------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {
  setupTabs();
  setupAnalyzeButton();
  setupClearHistoryButton();
  setupBackgroundListener();

  document.getElementById("open-options-btn").addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  initAnalyzeButton();
  refreshHistory();
  refreshUsage();
});
