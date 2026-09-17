// ViewDigest - popup script

import { getHistory, deleteAnalysis } from "../utils/storage.js";
import { getUsageStats, checkRateLimit } from "../utils/cost.js";
import { renderMarkdown } from "../utils/markdown.js";

const YOUTUBE_WATCH_RE = /^https:\/\/(www\.)?youtube\.com\/watch\?.*v=/;

// 현재 "현재 분석" 탭에 표시 중인 결과의 원본 정보. 복사/다운로드/다시분석에 사용한다.
let currentEntry = null; // { title, url, markdown, model, estimatedCost, createdAt, ... }

// ---------------------------------------------------------------------
// 탭 전환
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

// ---------------------------------------------------------------------
// "현재 분석" 탭: 상태 전환
// ---------------------------------------------------------------------

const stateViews = {
  idle: document.getElementById("current-idle"),
  loading: document.getElementById("current-loading"),
  error: document.getElementById("current-error"),
  result: document.getElementById("current-result"),
};

function setCurrentState(state, payload) {
  Object.entries(stateViews).forEach(([name, el]) => {
    el.classList.toggle("hidden", name !== state);
  });

  if (state === "error") {
    document.getElementById("error-message-text").textContent =
      payload?.message ?? "알 수 없는 오류가 발생했습니다.";
  }

  if (state === "result" && payload) {
    renderResult(payload);
  }
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

function formatCost(usd) {
  if (typeof usd !== "number" || Number.isNaN(usd)) return "$0.0000";
  return `$${usd.toFixed(4)}`;
}

function renderResult(entry) {
  currentEntry = entry;

  document.getElementById("result-title").textContent = entry.title ?? "제목 없음";
  document.getElementById("result-date").textContent = formatDate(entry.createdAt);
  document.getElementById("result-model").textContent = entry.model ?? "-";
  document.getElementById("result-cost").textContent = `예상 비용 ${formatCost(entry.estimatedCost)}`;
  document.getElementById("result-content").innerHTML = renderMarkdown(entry.markdown ?? "");
}

// ---------------------------------------------------------------------
// 분석 시작/재시도
// ---------------------------------------------------------------------

function requestAnalysis(url) {
  if (!url) return;
  setCurrentState("loading");

  chrome.runtime.sendMessage({ action: "analyzeVideo", url }, (response) => {
    if (chrome.runtime.lastError) {
      setCurrentState("error", { message: chrome.runtime.lastError.message });
      return;
    }
    if (!response) return; // background가 별도 브로드캐스트로 결과를 전달할 예정
    if (response.success) {
      setCurrentState("result", response.result);
      refreshHistory();
      refreshUsage();
    } else {
      setCurrentState("error", response.error);
    }
  });
}

async function getActiveYoutubeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !YOUTUBE_WATCH_RE.test(tab.url)) return null;
  return tab;
}

async function initCurrentTab() {
  const tab = await getActiveYoutubeTab();
  const startBtn = document.getElementById("start-analyze-btn");
  const hint = document.getElementById("idle-hint");

  if (tab) {
    startBtn.disabled = false;
    startBtn.dataset.url = tab.url;
    hint.textContent = "";
  } else {
    startBtn.disabled = true;
    hint.textContent = "YouTube 영상 시청 페이지에서만 분석할 수 있어요.";
  }
}

function setupCurrentTabActions() {
  document.getElementById("start-analyze-btn").addEventListener("click", (e) => {
    requestAnalysis(e.currentTarget.dataset.url);
  });

  document.getElementById("retry-btn").addEventListener("click", async () => {
    const tab = await getActiveYoutubeTab();
    requestAnalysis(currentEntry?.url ?? tab?.url);
  });

  document.getElementById("reanalyze-btn").addEventListener("click", () => {
    if (currentEntry?.url) requestAnalysis(currentEntry.url);
  });

  document.getElementById("copy-btn").addEventListener("click", copyCurrentMarkdown);
  document.getElementById("download-btn").addEventListener("click", downloadCurrentMarkdown);
}

async function copyCurrentMarkdown() {
  if (!currentEntry?.markdown) return;
  const btn = document.getElementById("copy-btn");
  try {
    await navigator.clipboard.writeText(currentEntry.markdown);
  } catch {
    // 클립보드 API 사용이 막힌 환경을 위한 대체 경로
    const textarea = document.createElement("textarea");
    textarea.value = currentEntry.markdown;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
  const original = btn.textContent;
  btn.textContent = "✅ 복사됨";
  setTimeout(() => {
    btn.textContent = original;
  }, 1500);
}

function downloadCurrentMarkdown() {
  if (!currentEntry?.markdown) return;
  const safeTitle = (currentEntry.title ?? "analysis").replace(/[\\/:*?"<>|]/g, "_").slice(0, 80);
  const blob = new Blob([currentEntry.markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safeTitle}.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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

  for (const entry of history) {
    const li = document.createElement("li");
    li.className = "history-item";

    const main = document.createElement("div");
    main.className = "history-item-main";

    const title = document.createElement("div");
    title.className = "history-item-title";
    title.textContent = entry.title ?? "제목 없음";

    const meta = document.createElement("div");
    meta.className = "history-item-meta";
    meta.innerHTML = `<span>${formatDate(entry.createdAt)}</span><span class="model-badge">${
      entry.model ?? "-"
    }</span>`;

    main.append(title, meta);

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "history-delete-btn";
    deleteBtn.type = "button";
    deleteBtn.title = "삭제";
    deleteBtn.textContent = "🗑";
    deleteBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await deleteAnalysis(entry.id);
      refreshHistory();
    });

    main.addEventListener("click", () => {
      setCurrentState("result", entry);
      switchTab("current");
    });

    li.append(main, deleteBtn);
    list.appendChild(li);
  }
}

// ---------------------------------------------------------------------
// 사용량 탭
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

  const status = document.getElementById("rate-limit-status");
  status.textContent = rateLimit.allowed
    ? `오늘 ${rateLimit.remaining}회 더 분석할 수 있어요.`
    : "오늘의 분석 한도를 모두 사용했습니다. 내일 다시 시도해주세요.";
}

// ---------------------------------------------------------------------
// 백그라운드에서 오는 브로드캐스트 (content.js 버튼 등으로 트리거된 분석 포함)
// ---------------------------------------------------------------------

function setupBackgroundListener() {
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.action === "analysisComplete") {
      setCurrentState("result", message.result);
      refreshHistory();
      refreshUsage();
    } else if (message?.action === "analysisError") {
      setCurrentState("error", message.error);
    }
  });
}

// ---------------------------------------------------------------------
// 초기화
// ---------------------------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {
  setupTabs();
  setupCurrentTabActions();
  setupBackgroundListener();

  document.getElementById("open-options-btn").addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  setCurrentState("idle");
  initCurrentTab();
  refreshHistory();
  refreshUsage();
});
