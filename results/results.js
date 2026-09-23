// ViewDigest - 분석 결과 탭 스크립트
//
// 두 가지 방식으로 열린다:
// 1. content.js의 "⚡ 영상 분석" 버튼 / popup의 "🔍 지금 분석하기" 버튼이
//    ?url=&title=으로 이 페이지를 연다. 이때는 analyzeYouTubeVideoStream()을
//    직접 호출해, 전체 분석이 끝날 때까지 기다리지 않고 Gemini가 생성하는
//    대로 리포트를 점진적으로 렌더링한다.
// 2. popup의 히스토리 항목 클릭이 ?entryId=로 이 페이지를 연다. 이때는 이미
//    저장된 분석 결과를 그대로 불러와 즉시 렌더링한다(재분석하지 않음).

import { analyzeYouTubeVideoStream, GeminiApiError } from "../utils/gemini.js";
import { getSettings, saveAnalysis, getHistory } from "../utils/storage.js";
import { renderMarkdown } from "../utils/markdown.js";
import { t, localizePage } from "../utils/i18n.js";

localizePage();

const params = new URLSearchParams(location.search);
const videoUrl = params.get("url");
const videoTitle = params.get("title");
const entryId = params.get("entryId");

function extractVideoId(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("youtu.be")) {
      return parsed.pathname.slice(1) || null;
    }
    return parsed.searchParams.get("v");
  } catch {
    return null;
  }
}

const els = {
  title: document.getElementById("result-title"),
  metaLine: document.getElementById("result-meta-line"),
  statusView: document.getElementById("status-view"),
  statusText: document.getElementById("status-text"),
  errorView: document.getElementById("error-view"),
  errorText: document.getElementById("error-text"),
  content: document.getElementById("result-content"),
  actions: document.getElementById("result-actions"),
  copyBtn: document.getElementById("copy-btn"),
  downloadBtn: document.getElementById("download-btn"),
};

let finalEntry = null;

function showStatus(message) {
  els.statusView.classList.remove("hidden");
  els.errorView.classList.add("hidden");
  els.statusText.textContent = message;
}

function showError(message) {
  els.statusView.classList.add("hidden");
  els.errorView.classList.remove("hidden");
  els.errorText.textContent = message;
}

function renderReport(markdown) {
  els.statusView.classList.add("hidden");
  els.errorView.classList.add("hidden");
  els.content.classList.remove("hidden");
  els.content.innerHTML = renderMarkdown(markdown);
}

function formatCost(usd) {
  if (typeof usd !== "number" || Number.isNaN(usd)) return "$0.0000";
  return `$${usd.toFixed(4)}`;
}

// ---------------------------------------------------------------------
// 복사 / 다운로드
// ---------------------------------------------------------------------

async function copyMarkdown() {
  if (!finalEntry?.markdown) return;
  try {
    await navigator.clipboard.writeText(finalEntry.markdown);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = finalEntry.markdown;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
  const original = els.copyBtn.textContent;
  els.copyBtn.textContent = t("resultsCopied");
  setTimeout(() => {
    els.copyBtn.textContent = original;
  }, 1500);
}

function downloadMarkdown() {
  if (!finalEntry?.markdown) return;
  const safeTitle = (finalEntry.title ?? "analysis").replace(/[\\/:*?"<>|]/g, "_").slice(0, 80);
  const blob = new Blob([finalEntry.markdown], { type: "text/markdown;charset=utf-8" });
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
// 저장된 히스토리 항목을 그대로 표시 (재분석하지 않음)
// ---------------------------------------------------------------------

async function runFromHistory(id) {
  const history = await getHistory();
  const entry = history.find((e) => e.id === id);
  if (!entry) {
    showError(t("resultsNotFound"));
    return;
  }

  finalEntry = entry;
  document.title = `${entry.title ?? t("untitled")} - ViewDigest`;
  els.title.textContent = entry.title ?? t("untitled");
  els.metaLine.textContent = t("resultsMeta", entry.model ?? "-", formatCost(entry.estimatedCost));
  els.metaLine.classList.remove("hidden");
  renderReport(entry.markdown ?? "");
  els.actions.classList.remove("hidden");
}

// ---------------------------------------------------------------------
// 새 분석 실행 (스트리밍)
// ---------------------------------------------------------------------

async function runNewAnalysis() {
  const videoId = extractVideoId(videoUrl);
  const initialTitle = videoTitle || videoId || t("untitled");
  document.title = `${initialTitle} - ViewDigest`;
  els.title.textContent = initialTitle;

  try {
    const settings = await getSettings();

    for await (const event of analyzeYouTubeVideoStream(videoUrl, {
      model: settings.model,
      customPrompt: settings.customPrompt,
      reportLanguage: settings.reportLanguage,
    })) {
      if (event.type === "status") {
        showStatus(event.message);
      } else if (event.type === "delta") {
        renderReport(event.markdown);
      } else if (event.type === "done") {
        const savedEntry = await saveAnalysis({
          videoId,
          title: initialTitle,
          url: videoUrl,
          markdown: event.result.markdown,
          model: event.result.model,
          estimatedTokens: event.result.usage.totalTokens,
          estimatedCost: event.result.estimatedCost,
        });

        finalEntry = savedEntry;
        document.title = `${savedEntry.title} - ViewDigest`;
        els.title.textContent = savedEntry.title;
        els.metaLine.textContent = t("resultsMeta", savedEntry.model, formatCost(savedEntry.estimatedCost));
        els.metaLine.classList.remove("hidden");
        els.actions.classList.remove("hidden");

        // popup이 열려있다면 히스토리/사용량을 즉시 갱신할 수 있도록 알린다.
        chrome.runtime.sendMessage({ action: "analysisComplete", result: savedEntry }, () => {
          void chrome.runtime.lastError;
        });
      }
    }
  } catch (error) {
    console.error("[results 분석 실패]", videoUrl, error);
    const message =
      error instanceof GeminiApiError
        ? error.message
        : t("resultsUnknownError");
    showError(message);
  }
}

async function run() {
  if (entryId) {
    await runFromHistory(entryId);
    return;
  }

  if (!videoUrl) {
    showError(t("resultsNoUrl"));
    return;
  }

  await runNewAnalysis();
}

document.addEventListener("DOMContentLoaded", () => {
  els.copyBtn.addEventListener("click", copyMarkdown);
  els.downloadBtn.addEventListener("click", downloadMarkdown);
  run();
});
