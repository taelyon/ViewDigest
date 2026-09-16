// ViewDigest - popup script

import { getHistory, deleteAnalysis } from "../utils/storage.js";
import { getUsageStats, checkRateLimit } from "../utils/cost.js";

const YOUTUBE_WATCH_RE = /^https:\/\/(www\.)?youtube\.com\/watch\?.*v=/;

// 현재 "현재 분석" 탭에 표시 중인 결과의 원본 정보. 복사/다운로드/다시분석에 사용한다.
let currentEntry = null; // { title, url, markdown, model, estimatedCost, createdAt, ... }

// ---------------------------------------------------------------------
// 아주 작은 마크다운 → HTML 렌더러
// (외부 라이브러리 없이, Gemini가 생성하는 구조화된 리포트 포맷만 지원)
// ---------------------------------------------------------------------

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * "00:00" / "12:34" / "1:02:03" 형태의 타임스탬프를 초 단위로 변환.
 * 형식이 아니면 null을 반환한다.
 */
function timestampToSeconds(text) {
  const parts = text.split(":").map(Number);
  if (parts.some((n) => Number.isNaN(n))) return null;

  if (parts.length === 2) {
    const [m, s] = parts;
    return m * 60 + s;
  }
  if (parts.length === 3) {
    const [h, m, s] = parts;
    return h * 3600 + m * 60 + s;
  }
  return null;
}

function renderInline(text) {
  let html = escapeHtml(text);

  // 타임스탬프를 가장 먼저 처리해, 이후 마크다운 치환이 만든 태그와 섞이지 않게 한다.
  html = html.replace(/\b(\d{1,2}(?::\d{2}){1,2})\b/g, (match) => {
    const seconds = timestampToSeconds(match);
    if (seconds === null) return match;
    return `<span class="timestamp-link" data-seconds="${seconds}" role="button" tabindex="0">${match}</span>`;
  });

  // [텍스트](URL) 링크
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
  );

  // **굵게** / __굵게__
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/__(.+?)__/g, "<strong>$1</strong>");

  // *기울임* / _기울임_
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
  html = html.replace(/(?<![\w`])_(.+?)_(?![\w`])/g, "<em>$1</em>");

  // `인라인 코드`
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  return html;
}

const BLOCK_START_RE = /^(#{1,4})\s+|^\s*[-*]\s+|^\s*\d+\.\s+|^>\s?|^(-{3,}|\*{3,})\s*$/;

function renderMarkdown(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let list = null; // { type: "ul" | "ol", items: string[] }
  let i = 0;

  function flushList() {
    if (!list) return;
    const items = list.items.map((item) => `<li>${renderInline(item)}</li>`).join("");
    blocks.push(`<${list.type}>${items}</${list.type}>`);
    list = null;
  }

  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*$/.test(line)) {
      flushList();
      i++;
      continue;
    }

    const header = line.match(/^(#{1,4})\s+(.*)$/);
    if (header) {
      flushList();
      const level = header[1].length;
      blocks.push(`<h${level}>${renderInline(header[2])}</h${level}>`);
      i++;
      continue;
    }

    if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
      flushList();
      blocks.push("<hr>");
      i++;
      continue;
    }

    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      flushList();
      const quoteLines = [quote[1]];
      i++;
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      blocks.push(`<blockquote>${renderInline(quoteLines.join(" "))}</blockquote>`);
      continue;
    }

    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    if (ul) {
      if (!list || list.type !== "ul") {
        flushList();
        list = { type: "ul", items: [] };
      }
      list.items.push(ul[1]);
      i++;
      continue;
    }

    const ol = line.match(/^\s*\d+\.\s+(.*)$/);
    if (ol) {
      if (!list || list.type !== "ol") {
        flushList();
        list = { type: "ol", items: [] };
      }
      list.items.push(ol[1]);
      i++;
      continue;
    }

    // 문단: 다음 블록 시작 전까지의 줄을 한 문단으로 묶는다.
    flushList();
    const paragraph = [line];
    i++;
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !BLOCK_START_RE.test(lines[i])) {
      paragraph.push(lines[i]);
      i++;
    }
    blocks.push(`<p>${renderInline(paragraph.join(" "))}</p>`);
  }

  flushList();
  return blocks.join("\n");
}

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
  showSeekFeedback("", null); // 이전 결과에서 남아있던 타임스탬프 이동 에러 메시지를 지운다
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

  // 타임스탬프 클릭/키보드 처리 (이벤트 위임)
  const resultContent = document.getElementById("result-content");
  resultContent.addEventListener("click", (e) => {
    const target = e.target.closest(".timestamp-link");
    if (target) seekToTimestamp(target);
  });
  resultContent.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const target = e.target.closest(".timestamp-link");
    if (target) {
      e.preventDefault();
      seekToTimestamp(target);
    }
  });
}

let seekFeedbackTimer = null;

function showSeekFeedback(message, type) {
  const el = document.getElementById("seek-feedback");
  if (!el) return;
  el.textContent = message;
  el.className = `feedback${type ? ` ${type}` : ""}`;

  clearTimeout(seekFeedbackTimer);
  if (message) {
    seekFeedbackTimer = setTimeout(() => {
      el.textContent = "";
      el.className = "feedback";
    }, 3500);
  }
}

function seekToTimestamp(el) {
  const seconds = Number(el.dataset.seconds);
  if (!Number.isFinite(seconds)) return;

  // videoId를 함께 보내, background가 "지금 보고 있는 리포트의 영상"이 실제로
  // 열려있는 탭을 찾아 그 탭에만 seek을 적용하도록 한다 (엉뚱한 영상 탐색 방지).
  chrome.runtime.sendMessage(
    { action: "seekTo", seconds, videoId: currentEntry?.videoId },
    (response) => {
      if (chrome.runtime.lastError) {
        showSeekFeedback(chrome.runtime.lastError.message, "error");
        return;
      }
      if (response?.success) {
        showSeekFeedback("", null); // 이전에 남아있던 에러 메시지를 즉시 지운다
      } else {
        showSeekFeedback(response?.error?.message ?? "영상으로 이동하지 못했습니다.", "error");
      }
    }
  );
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
