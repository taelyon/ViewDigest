// ViewDigest - 분석 결과 탭 스크립트
//
// content.js의 "⚡ 영상 분석" 버튼이 이 페이지를 새 탭으로 연다(?url=&title=).
// 여기서 직접 analyzeYouTubeVideoStream()을 호출해, 전체 분석이 끝날 때까지
// 기다리지 않고 Gemini가 생성하는 대로 리포트를 점진적으로 렌더링한다.

import { analyzeYouTubeVideoStream, GeminiApiError } from "../utils/gemini.js";
import { getSettings, saveAnalysis } from "../utils/storage.js";
import { renderMarkdown } from "../utils/markdown.js";

const params = new URLSearchParams(location.search);
const videoUrl = params.get("url");
const videoTitle = params.get("title");

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

function showStreamingMarkdown(markdown) {
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
// 타임스탬프 클릭 → 원본 YouTube 탭 탐색(seek)
// ---------------------------------------------------------------------

function seekToTimestamp(el) {
  const seconds = Number(el.dataset.seconds);
  if (!Number.isFinite(seconds)) return;
  chrome.runtime.sendMessage(
    { action: "seekTo", seconds, videoId: extractVideoId(videoUrl) },
    () => void chrome.runtime.lastError
  );
}

function setupTimestampClicks() {
  els.content.addEventListener("click", (e) => {
    const target = e.target.closest(".timestamp-link");
    if (target) seekToTimestamp(target);
  });
  els.content.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const target = e.target.closest(".timestamp-link");
    if (target) {
      e.preventDefault();
      seekToTimestamp(target);
    }
  });
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
  els.copyBtn.textContent = "✅ 복사됨";
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
// 분석 실행
// ---------------------------------------------------------------------

async function run() {
  if (!videoUrl) {
    showError("분석할 영상 URL을 찾을 수 없습니다. 이 페이지는 ViewDigest 확장프로그램의 분석 버튼을 통해서만 열 수 있습니다.");
    return;
  }

  const videoId = extractVideoId(videoUrl);
  const initialTitle = videoTitle || videoId || "제목 없음";
  document.title = `${initialTitle} - ViewDigest`;
  els.title.textContent = initialTitle;

  try {
    const settings = await getSettings();

    for await (const event of analyzeYouTubeVideoStream(videoUrl, {
      model: settings.model,
      customPrompt: settings.customPrompt,
    })) {
      if (event.type === "status") {
        showStatus(event.message);
      } else if (event.type === "delta") {
        showStreamingMarkdown(event.markdown);
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
        els.metaLine.textContent = `${savedEntry.model} · 예상 비용 ${formatCost(savedEntry.estimatedCost)}`;
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
        : "분석 중 알 수 없는 오류가 발생했습니다.";
    showError(message);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  setupTimestampClicks();
  els.copyBtn.addEventListener("click", copyMarkdown);
  els.downloadBtn.addEventListener("click", downloadMarkdown);
  run();
});
