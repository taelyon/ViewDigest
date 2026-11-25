// View Digest - 분석 결과 탭 스크립트
//
// 두 가지 방식으로 열린다:
// 1. content.js의 "⚡ 영상 분석" 버튼 / popup의 "🔍 지금 분석하기" 버튼이
//    ?url=&title=으로 이 페이지를 연다. 이때는 analyzeYouTubeVideoStream()을
//    직접 호출해, 전체 분석이 끝날 때까지 기다리지 않고 Gemini가 생성하는
//    대로 리포트를 점진적으로 렌더링한다.
// 2. popup의 히스토리 항목 클릭이 ?entryId=로 이 페이지를 연다. 이때는 이미
//    저장된 분석 결과를 그대로 불러와 즉시 렌더링한다(재분석하지 않음).

import { analyzeYouTubeVideoStream, askAboutVideo, GeminiApiError } from "../utils/gemini.js";
import {
  getSettings,
  setSettings,
  saveAnalysis,
  getHistory,
  removeUnseenIds,
  setAnalysisInProgress,
  patchHistoryEntries,
} from "../utils/storage.js";
import { renderMarkdown } from "../utils/markdown.js";
import { fetchVideoOEmbed, fetchVideoPageInfo, fetchVideoPublishDate } from "../utils/channels.js";
import { estimateAnalysisCost, formatUsd } from "../utils/cost.js";
import { t, localizePage, formatDateTime, formatDate, displayLanguage } from "../utils/i18n.js";
import { getSampleReport } from "../utils/sample-report.js";
import { refreshBadge } from "../utils/badge.js";
import {
  storePageUrl,
  storeReviewUrl,
  recordSuccessfulAnalysis,
  reviewPromptCount,
  answerReviewPrompt,
} from "../utils/review.js";

localizePage();

const params = new URLSearchParams(location.search);
const videoUrl = params.get("url");
const videoTitle = params.get("title");
const entryId = params.get("entryId");
// "다시 분석"을 눌러 연 경우. 이미 분석한 영상이어도 저장된 리포트 대신 새로 분석한다.
const reanalyze = params.get("reanalyze") === "1";
// 시작 가이드에서 연 예시 리포트. API 키 없이 결과물의 모습을 보여 준다.
const sample = params.get("sample") === "1";
// YouTube 탭의 분석 버튼이 알려 준 영상 길이(초). 예상 비용 계산에 쓴다.
const durationParam = Number(params.get("duration"));
const GUIDE_URL = chrome.runtime.getURL("welcome/welcome.html");
const LITE_MODEL = "gemini-3.5-flash-lite";

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
  reanalyzeBtn: document.getElementById("reanalyze-btn"),
  savedNotice: document.getElementById("saved-notice"),
  savedNoticeText: document.getElementById("saved-notice-text"),
  noticeReanalyzeBtn: document.getElementById("notice-reanalyze-btn"),
  errorActions: document.getElementById("error-actions"),
  sampleNotice: document.getElementById("sample-notice"),
  sampleGuideBtn: document.getElementById("sample-guide-btn"),
  statusEstimate: document.getElementById("status-estimate"),
  obsidianBtn: document.getElementById("obsidian-btn"),
  printBtn: document.getElementById("print-btn"),
  printSource: document.getElementById("print-source"),
};

let finalEntry = null;

function showStatus(message) {
  els.statusView.classList.remove("hidden");
  els.errorView.classList.add("hidden");
  els.statusText.textContent = message;
}

function showError(message, code) {
  els.statusView.classList.add("hidden");
  els.errorView.classList.remove("hidden");
  els.errorText.textContent = message;
  showErrorActions(code);
}

function actionButton(label, onClick, primary = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = primary ? "primary-btn" : "secondary-btn";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function actionLink(label, href) {
  const link = document.createElement("a");
  link.className = "secondary-btn";
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = label;
  return link;
}

/** 같은 영상을 새로 분석한다(이미 저장된 결과가 있어도). */
function retryAnalysis() {
  const url = new URL(location.href);
  url.searchParams.set("reanalyze", "1");
  location.replace(url.toString());
}

/**
 * 오류만 보여 주면 사용자가 무엇을 해야 할지 모르는 경우, 해결 방법을 버튼으로 둔다.
 * - 한도 초과: 다시 시도, 경제형 모델로 바꿔 다시 시도, 사용량 확인, 결제 설정
 * - API 키 없음: 시작 가이드
 */
async function showErrorActions(code) {
  els.errorActions.replaceChildren();
  const items = [];
  if (code === "QUOTA_EXCEEDED") {
    items.push(actionButton(t("resultsRetry"), retryAnalysis, true));
    const { model } = await getSettings();
    if (model !== LITE_MODEL) {
      items.push(
        actionButton(t("resultsUseLiteModel"), async () => {
          await setSettings({ model: LITE_MODEL });
          retryAnalysis();
        })
      );
    }
    items.push(actionLink(t("resultsCheckUsage"), "https://ai.dev/rate-limit"));
    items.push(actionLink(t("resultsSetUpBilling"), "https://aistudio.google.com/apikey"));
    const hint = document.createElement("p");
    hint.className = "error-hint";
    hint.textContent = t("resultsQuotaHint");
    items.push(hint);
  } else if (code === "MISSING_API_KEY") {
    items.push(actionButton(t("resultsOpenGuide"), () => window.open(GUIDE_URL, "_blank"), true));
  } else if (code === "BUDGET_EXCEEDED" || code === "RATE_LIMITED") {
    items.push(actionButton(t("resultsOpenSettings"), () => chrome.runtime.openOptionsPage(), true));
  }
  els.errorActions.append(...items);
  els.errorActions.classList.toggle("hidden", items.length === 0);
}

/** 예시 리포트를 보여 준다. 저장하지 않고, 복사·재분석 버튼도 두지 않는다. */
function showSample() {
  const entry = getSampleReport(displayLanguage());
  document.title = `${entry.title} - View Digest`;
  els.title.textContent = entry.title;
  showMeta(entry);
  renderReport(entry.markdown);
  els.sampleNotice.classList.remove("hidden");
}

function renderReport(markdown) {
  els.statusView.classList.add("hidden");
  els.errorView.classList.add("hidden");
  els.content.classList.remove("hidden");
  els.content.innerHTML = renderMarkdown(markdown);
}

/**
 * 제목 아래 줄에는 영상의 채널 이름을 보여준다. 모델과 예상 비용은 그 줄에 마우스를
 * 올리면 보인다. 채널 이름을 모르면(예전 기록, 비공개·삭제된 영상) 줄을 숨긴다.
 */
function showMeta({ channelTitle, publishedAt, createdAt, model, estimatedCost }) {
  const parts = [channelTitle, publishedAt ? t("resultsPublished", formatDate(publishedAt)) : null].filter(Boolean);
  els.metaLine.textContent = parts.join(" · ");
  els.metaLine.title = [
    model ? t("resultsMeta", model, formatCost(estimatedCost)) : "",
    createdAt ? t("historyAnalyzedFull", formatDateTime(createdAt)) : "",
  ].filter(Boolean).join("\n");
  els.metaLine.classList.toggle("hidden", parts.length === 0);
}

/**
 * 게시 시각을 저장하지 않던 버전에서 만든 기록이면, 열 때 한 번 알아내 저장하고 화면에 반영한다.
 */
async function fillPublishDate(entry) {
  if (entry.publishedAt !== undefined || !entry.url) return;
  const publishedAt = await fetchVideoPublishDate(entry.url);
  if (publishedAt === undefined) return;
  await patchHistoryEntries(new Map([[entry.id, { publishedAt }]]));
  if (finalEntry?.id === entry.id) {
    finalEntry = { ...finalEntry, publishedAt };
    showMeta(finalEntry);
  }
}

function formatCost(usd) {
  if (typeof usd !== "number" || Number.isNaN(usd)) return "$0.0000";
  return `$${usd.toFixed(4)}`;
}

// ---------------------------------------------------------------------
// 복사 / 다운로드
// ---------------------------------------------------------------------

/**
 * 복사·다운로드하는 리포트 끝에 원본 영상과 ViewDigest 출처를 붙인다(설정에서 끌 수 있다).
 * 받는 사람이 원본 영상을 찾을 수 있고, 어떤 도구로 만든 요약인지 알 수 있다.
 */
async function markdownForSharing(entry) {
  const settings = await getSettings();
  const body = [linkHeadingTimestamps(entry.markdown, entry.url).trimEnd()];
  const qa = qaMarkdown(entry.qa);
  if (qa) body.push("", qa);
  if (settings.shareAttribution === false) return `${body.join("\n")}\n`;

  const lines = [...body, "", "---", ""];
  if (entry.url) {
    const title = (entry.title ?? entry.url).replace(/[[\]]/g, "\\$&");
    lines.push(t("shareSourceVideo", `[${title}](${entry.url})`), "");
  }
  lines.push(`Made with [View Digest](${storePageUrl()})`, "");
  return lines.join("\n");
}

const HEADING_TIMESTAMP_RE = /\[\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\s*\]\s*$/;

/**
 * 소제목 끝의 [분:초]를 그 장면으로 가는 YouTube 링크로 바꾼다. 복사·다운로드한 리포트를
 * Notion·Obsidian 같은 곳에서 읽을 때도 시각을 눌러 바로 그 장면을 볼 수 있다.
 */
function linkHeadingTimestamps(markdown, url) {
  const videoId = url ? extractVideoId(url) : null;
  if (!videoId) return markdown;
  return markdown
    .split("\n")
    .map((line) => {
      if (!/^#{1,6}\s/.test(line)) return line;
      return line.replace(HEADING_TIMESTAMP_RE, (match, h, m, sec) => {
        const seconds = Number(h ?? 0) * 3600 + Number(m) * 60 + Number(sec);
        const label = match.replace(/[[\]\s]/g, "");
        return `[${label}](https://www.youtube.com/watch?v=${videoId}&t=${seconds}s)`;
      });
    })
    .join("\n");
}

/** 질문과 답변을 리포트 끝에 붙일 Markdown. 질문이 없으면 빈 문자열. */
function qaMarkdown(qa) {
  if (!qa?.length) return "";
  const lines = [`# ${t("qaExportHeading")}`, ""];
  for (const item of qa) {
    lines.push(`**Q. ${item.question.replace(/\s+/g, " ").trim()}**`, "", item.answer.trim(), "");
  }
  return lines.join("\n").trimEnd();
}

/** Obsidian 속성(YAML front matter). 값은 JSON 문자열로 써서 따옴표·콜론이 있어도 깨지지 않게 한다. */
function frontMatter(entry) {
  const quote = (value) => JSON.stringify(String(value));
  const date = (iso) => (iso ? String(iso).slice(0, 10) : null);
  const fields = [
    ["title", entry.title],
    ["source", entry.url],
    ["channel", entry.channelTitle],
    ["published", date(entry.publishedAt)],
    ["analyzed", date(entry.createdAt)],
  ].filter(([, value]) => value);
  return [
    "---",
    ...fields.map(([key, value]) => `${key}: ${quote(value)}`),
    "tags:",
    "  - youtube",
    "  - view-digest",
    "---",
    "",
  ].join("\n");
}

async function copyMarkdown() {
  if (!finalEntry?.markdown) return;
  const text = await markdownForSharing(finalEntry);
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
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

async function downloadMarkdown({ withFrontMatter = false } = {}) {
  if (!finalEntry?.markdown) return;
  const safeTitle = (finalEntry.title ?? "analysis").replace(/[\\/:*?"<>|]/g, "_").slice(0, 80);
  const text = await markdownForSharing(finalEntry);
  const content = withFrontMatter ? `${frontMatter(finalEntry)}\n${text}` : text;
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
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
// 웹스토어 리뷰 요청: 분석이 몇 번 성공한 뒤, 막 끝난 분석 옆에 작게 띄운다
// ---------------------------------------------------------------------

const reviewCard = {
  root: document.getElementById("review-card"),
  text: document.getElementById("review-card-text"),
  now: document.getElementById("review-now-btn"),
  later: document.getElementById("review-later-btn"),
  never: document.getElementById("review-never-btn"),
};

async function maybeAskForReview() {
  const count = await reviewPromptCount();
  if (count === null) return;
  reviewCard.text.textContent = t("reviewText", count);
  reviewCard.root.classList.remove("hidden");
}

function setupReviewCard() {
  const answer = async (kind) => {
    reviewCard.root.classList.add("hidden");
    await answerReviewPrompt(kind);
  };
  reviewCard.now.addEventListener("click", () => {
    window.open(storeReviewUrl(), "_blank", "noopener");
    answer("review");
  });
  reviewCard.later.addEventListener("click", () => answer("later"));
  reviewCard.never.addEventListener("click", () => answer("never"));
}

// ---------------------------------------------------------------------
// 저장된 히스토리 항목을 그대로 표시 (재분석하지 않음)
// ---------------------------------------------------------------------

function showSavedEntry(entry, { alreadyAnalyzed = false } = {}) {
  finalEntry = entry;
  // 알림을 눌러 연 채널 자동 분석 리포트라면, 이제 본 것이므로 아이콘 배지에서 뺀다.
  removeUnseenIds([entry.id]).then(refreshBadge);
  document.title = `${entry.title ?? t("untitled")} - View Digest`;
  els.title.textContent = entry.title ?? t("untitled");
  showMeta(entry);
  fillPublishDate(entry);
  renderReport(entry.markdown ?? "");
  els.actions.classList.remove("hidden");
  els.reanalyzeBtn.classList.toggle("hidden", !entry.url);
  showPrintSource(entry);
  showQa(entry);
  if (alreadyAnalyzed) {
    els.savedNoticeText.textContent = t("resultsAlreadyAnalyzed", formatDateTime(entry.createdAt));
    els.savedNotice.classList.remove("hidden");
  }
}

async function runFromHistory(id) {
  const history = await getHistory();
  const entry = history.find((e) => e.id === id);
  if (!entry) {
    showError(t("resultsNotFound"));
    return;
  }
  showSavedEntry(entry);
}

// 같은 영상을 새로 분석한다(비용이 다시 든다). 끝나면 히스토리의 이전 결과를 대신한다.
function reanalyzeCurrent() {
  if (!finalEntry?.url) return;
  const url = new URL(location.href);
  url.search = "";
  url.searchParams.set("url", finalEntry.url);
  if (finalEntry.title) url.searchParams.set("title", finalEntry.title);
  url.searchParams.set("reanalyze", "1");
  location.replace(url.toString());
}

// ---------------------------------------------------------------------
// 새 분석 실행 (스트리밍)
// ---------------------------------------------------------------------

async function runNewAnalysis() {
  const videoId = extractVideoId(videoUrl);
  let currentTitle = videoTitle || videoId || t("untitled");
  const setTitle = (title) => {
    currentTitle = title;
    document.title = `${title} - View Digest`;
    els.title.textContent = title;
  };
  // 히스토리에 채널 이름을 함께 남긴다. 분석이 한참 걸리므로 그동안 미리 알아 둔다.
  // 제목을 모르고 열렸으면(오른쪽 클릭으로 링크를 분석) 제목도 YouTube에 묻는다.
  const oembedPromise = fetchVideoOEmbed(videoUrl);
  const channelTitlePromise = oembedPromise.then((info) => (info === undefined ? undefined : info?.channelTitle ?? null));
  const pageInfoPromise = fetchVideoPageInfo(videoUrl);
  const publishedAtPromise = pageInfoPromise.then((info) => (info === undefined ? undefined : info?.publishedAt ?? null));
  // 분석은 한참 걸리므로, 채널 이름과 게시일은 알게 되는 즉시 보여준다.
  Promise.all([channelTitlePromise, publishedAtPromise]).then(([channelTitle, publishedAt]) => {
    if (!finalEntry) showMeta({ channelTitle, publishedAt });
  });
  channelTitlePromise.then((channelTitle) => {
    if (channelTitle && !finalEntry) showMeta({ channelTitle });
  });
  if (!videoTitle) {
    oembedPromise.then((info) => {
      if (info?.title && !finalEntry) setTitle(info.title);
    });
  }
  setTitle(currentTitle);
  if (videoId) await setAnalysisInProgress(videoId, true);

  try {
    const settings = await getSettings();
    showEstimate(settings, pageInfoPromise);

    for await (const event of analyzeYouTubeVideoStream(videoUrl, {
      model: settings.model,
      customPrompt: settings.customPrompt,
      reportLanguage: settings.reportLanguage,
      reportLength: settings.reportLength,
    })) {
      if (event.type === "status") {
        showStatus(event.message);
      } else if (event.type === "delta") {
        renderReport(event.markdown);
      } else if (event.type === "done") {
        if (!videoTitle) {
          const info = await oembedPromise;
          if (info?.title) currentTitle = info.title;
        }
        const savedEntry = await saveAnalysis({
          videoId,
          title: currentTitle,
          channelTitle: await channelTitlePromise,
          publishedAt: await publishedAtPromise,
          url: videoUrl,
          markdown: event.result.markdown,
          model: event.result.model,
          estimatedTokens: event.result.usage.totalTokens,
          estimatedCost: event.result.estimatedCost,
        });

        finalEntry = savedEntry;
        document.title = `${savedEntry.title} - View Digest`;
        els.title.textContent = savedEntry.title;
        showMeta(savedEntry);
        els.actions.classList.remove("hidden");
        els.statusEstimate.classList.add("hidden");
        showPrintSource(savedEntry);
        showQa(savedEntry);

        await recordSuccessfulAnalysis();
        maybeAskForReview();

        // popup이 열려있다면 히스토리/사용량을 즉시 갱신할 수 있도록 알린다.
        chrome.runtime.sendMessage({ action: "analysisComplete", result: savedEntry }, () => {
          void chrome.runtime.lastError;
        });
      }
    }
  } catch (error) {
    // Gemini가 거절한 경우는 화면에 사유를 보여 주는 예상된 실패라 "오류"로 남기지 않는다.
    (error instanceof GeminiApiError ? console.log : console.error)("[results 분석 실패]", videoUrl, error);
    const message =
      error instanceof GeminiApiError
        ? error.message
        : t("resultsUnknownError");
    showError(message, error instanceof GeminiApiError ? error.code : undefined);
  } finally {
    if (videoId) await setAnalysisInProgress(videoId, false);
  }
}

/**
 * 분석하는 동안 예상 비용을 보여 준다. 영상 길이는 YouTube 탭이 알려 준 값을 먼저 쓰고,
 * 없으면(팝업·오른쪽 클릭으로 연 경우) 시청 페이지에서 읽는다.
 */
async function showEstimate(settings, pageInfoPromise) {
  let duration = Number.isFinite(durationParam) && durationParam > 0 ? durationParam : null;
  if (!duration) duration = (await pageInfoPromise)?.lengthSeconds ?? null;
  const estimate = estimateAnalysisCost(duration, settings.model, settings.reportLength);
  if (!estimate || finalEntry) return;
  els.statusEstimate.textContent = t(
    "resultsEstimate",
    formatUsd(estimate.cost),
    String(Math.max(1, Math.round(duration / 60)))
  );
  els.statusEstimate.classList.remove("hidden");
}

/** 인쇄·PDF에만 보이는 원본 영상 주소. */
function showPrintSource(entry) {
  els.printSource.textContent = entry.url ? t("printSource", entry.url) : "";
}

// ---------------------------------------------------------------------
// 영상에 질문하기
// ---------------------------------------------------------------------

const qa = {
  section: document.getElementById("qa-section"),
  list: document.getElementById("qa-list"),
  form: document.getElementById("qa-form"),
  input: document.getElementById("qa-input"),
  useVideo: document.getElementById("qa-use-video"),
  costHint: document.getElementById("qa-cost-hint"),
  submit: document.getElementById("qa-submit"),
  error: document.getElementById("qa-error"),
};
let qaBusy = false;

function qaItemElement(item) {
  const li = document.createElement("li");
  li.className = "qa-item";
  const question = document.createElement("p");
  question.className = "qa-question";
  question.textContent = item.question;
  const answer = document.createElement("div");
  answer.className = "qa-answer markdown-body";
  if (item.pending) {
    answer.classList.add("qa-pending");
    answer.textContent = t(item.useVideo ? "qaThinkingVideo" : "qaThinking");
  } else {
    answer.innerHTML = renderMarkdown(item.answer);
  }
  li.append(question, answer);
  if (!item.pending) {
    const meta = document.createElement("p");
    meta.className = "qa-meta";
    meta.textContent = [
      item.useVideo ? t("qaFromVideo") : t("qaFromReport"),
      typeof item.estimatedCost === "number" ? formatUsd(item.estimatedCost) : null,
    ]
      .filter(Boolean)
      .join(" · ");
    li.append(meta);
  }
  return li;
}

function renderQaList(items) {
  qa.list.replaceChildren(...items.map(qaItemElement));
}

function updateQaCostHint() {
  qa.costHint.textContent = qa.useVideo.checked ? t("qaCostVideo") : t("qaCostReport");
}

/** 리포트가 준비되면 질문 영역을 보여 준다. 저장된 질문·답변이 있으면 함께 보여 준다. */
function showQa(entry) {
  qa.section.classList.remove("hidden");
  // 영상 URL이 없는 항목(예시 리포트 등)은 영상 전체에서 찾을 수 없다.
  qa.useVideo.disabled = !entry.url;
  renderQaList(entry.qa ?? []);
  updateQaCostHint();
}

async function submitQuestion() {
  const question = qa.input.value.trim();
  if (!question || qaBusy || !finalEntry?.markdown) return;
  const useVideo = qa.useVideo.checked && Boolean(finalEntry.url);
  const previous = finalEntry.qa ?? [];

  qaBusy = true;
  qa.submit.disabled = true;
  qa.error.classList.add("hidden");
  renderQaList([...previous, { question, useVideo, pending: true }]);

  try {
    const settings = await getSettings();
    const result = await askAboutVideo({
      question,
      reportMarkdown: finalEntry.markdown,
      youtubeUrl: finalEntry.url,
      useVideo,
      previous,
      model: settings.model,
    });
    const item = {
      question,
      answer: result.answer,
      useVideo,
      model: result.model,
      estimatedCost: result.estimatedCost,
      createdAt: new Date().toISOString(),
    };
    finalEntry = { ...finalEntry, qa: [...previous, item] };
    renderQaList(finalEntry.qa);
    qa.input.value = "";
    if (finalEntry.id) await patchHistoryEntries(new Map([[finalEntry.id, { qa: finalEntry.qa }]]));
  } catch (error) {
    (error instanceof GeminiApiError ? console.log : console.error)("[질문 실패]", error);
    renderQaList(previous);
    qa.error.textContent = error instanceof GeminiApiError ? error.message : t("resultsUnknownError");
    qa.error.classList.remove("hidden");
  } finally {
    qaBusy = false;
    qa.submit.disabled = false;
  }
}

function setupQa() {
  qa.form.addEventListener("submit", (event) => {
    event.preventDefault();
    submitQuestion();
  });
  // Enter로 보내고 Shift+Enter로 줄을 바꾼다. 한글 입력 중(조합 중) Enter는 글자 확정이므로 보내지 않는다.
  qa.input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
      event.preventDefault();
      submitQuestion();
    }
  });
  qa.useVideo.addEventListener("change", updateQaCostHint);
}

/**
 * 이미 분석해 둔 영상이면 그 결과. 같은 영상을 또 분석해 비용이 나가지 않도록,
 * 분석 버튼을 눌러도 먼저 저장된 리포트를 보여준다("다시 분석"으로 새로 분석할 수 있다).
 */
async function findSavedAnalysis(url) {
  const videoId = extractVideoId(url);
  if (!videoId) return null;
  const history = await getHistory();
  return history.find((entry) => entry.videoId === videoId) ?? null;
}

async function run() {
  if (sample) {
    showSample();
    return;
  }

  if (entryId) {
    await runFromHistory(entryId);
    return;
  }

  if (!videoUrl) {
    showError(t("resultsNoUrl"));
    return;
  }

  if (!reanalyze) {
    const saved = await findSavedAnalysis(videoUrl);
    if (saved) {
      showSavedEntry(saved, { alreadyAnalyzed: true });
      return;
    }
  }

  await runNewAnalysis();
}

document.addEventListener("DOMContentLoaded", () => {
  els.copyBtn.addEventListener("click", copyMarkdown);
  els.downloadBtn.addEventListener("click", () => downloadMarkdown());
  els.obsidianBtn.addEventListener("click", () => downloadMarkdown({ withFrontMatter: true }));
  els.printBtn.addEventListener("click", () => window.print());
  setupQa();
  els.reanalyzeBtn.addEventListener("click", reanalyzeCurrent);
  setupReviewCard();
  // 소제목 옆 ▶ 시각 버튼. 리포트는 스트리밍 중에 계속 다시 그려지므로 위임으로 받는다.
  els.content.addEventListener("click", (event) => {
    const button = event.target.closest(".timestamp-link");
    const url = finalEntry?.url ?? videoUrl;
    if (!button || !url) return;
    chrome.runtime.sendMessage(
      { action: "seekVideo", url, seconds: Number(button.dataset.seconds) },
      () => void chrome.runtime.lastError
    );
  });
  // 긴 리포트 맨 아래까지 내려가지 않아도 되도록, 안내 옆에도 같은 버튼을 둔다.
  els.noticeReanalyzeBtn.addEventListener("click", reanalyzeCurrent);
  els.sampleGuideBtn.addEventListener("click", () => window.open(GUIDE_URL, "_blank"));
  run();
});
