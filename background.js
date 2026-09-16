// LilysAI Style YouTube Analyzer - background service worker
//
// content.js / popup.js 로부터 오는 메시지를 받아 실제 분석 파이프라인을 조율한다.
// manifest.json의 background.type이 "module"이므로 ES import를 사용할 수 있다.

import { analyzeYouTubeVideo, GeminiApiError } from "./utils/gemini.js";
import { checkRateLimit } from "./utils/cost.js";
import { getSettings, setSettings, saveAnalysis } from "./utils/storage.js";

// 동시에 같은 영상이 중복 분석되는 것을 막기 위한 진행 중 URL 집합.
// 서비스 워커가 유휴 상태에서 재시작되면 초기화되지만, 그 경우 이전 요청도
// 이미 끝났거나 의미가 없으므로 메모리 내 Set으로 충분하다.
const analysesInProgress = new Set();

// ---------------------------------------------------------------------
// 설치/업데이트 초기화
// ---------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason !== "install") return;

  // 이미 저장된 값을 덮어쓰지 않도록, 없는 설정만 기본값으로 채운다.
  const settings = await getSettings();
  if (settings.dailyLimit === undefined) {
    await setSettings({ dailyLimit: 20 });
  }
});

// ---------------------------------------------------------------------
// 유틸리티
// ---------------------------------------------------------------------

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

function extractTitle(tab, videoId) {
  // 탭 제목은 보통 "영상 제목 - YouTube" 형식이므로 접미사를 제거한다.
  const rawTitle = tab?.title;
  if (!rawTitle) return videoId ?? "제목 없음";
  return rawTitle.replace(/\s*-\s*YouTube\s*$/, "").trim() || (videoId ?? "제목 없음");
}

/**
 * GeminiApiError(또는 그 외 예외)를 popup/content로 전달할 수 있는
 * { code, message } 형태로 정규화한다.
 */
function normalizeError(error) {
  if (error instanceof GeminiApiError) {
    return { code: error.code, message: error.message };
  }
  return { code: "UNKNOWN_ERROR", message: error?.message ?? "알 수 없는 오류가 발생했습니다." };
}

/**
 * 분석 완료/실패 결과를 popup에 브로드캐스트한다.
 * popup이 열려있지 않으면 수신자가 없다는 runtime.lastError가 발생하지만,
 * 이는 정상적인 상황이므로 콜백에서 조회만 하고 무시한다.
 */
function notifyPopup(message) {
  chrome.runtime.sendMessage(message, () => {
    void chrome.runtime.lastError;
  });
}

// ---------------------------------------------------------------------
// analyzeVideo 처리
// ---------------------------------------------------------------------

async function handleAnalyzeVideo(url, tab) {
  // has() 확인과 add()를 그 사이에 await 없이(동기적으로) 수행해야, 거의 동시에
  // 들어온 두 번째 analyzeVideo 요청이 첫 번째 요청의 등록을 확실히 보고 걸러진다.
  // (add()를 비동기 작업 뒤로 미루면 그 틈에 두 요청이 모두 통과하는 경쟁 조건이 생긴다.)
  if (analysesInProgress.has(url)) {
    return { success: false, error: { code: "ALREADY_ANALYZING", message: "이미 이 영상을 분석하고 있습니다." } };
  }
  analysesInProgress.add(url);

  try {
    // gemini.js도 내부적으로 checkRateLimit()을 호출하지만, 여기서 먼저 확인하면
    // 불필요한 설정 조회/API 호출 준비 없이 빠르게 실패할 수 있다.
    const rateLimit = await checkRateLimit();
    if (!rateLimit.allowed) {
      const error = {
        code: "RATE_LIMITED",
        message: `오늘의 분석 가능 횟수(${rateLimit.limit}회)를 모두 사용했습니다.`,
      };
      notifyPopup({ action: "analysisError", url, error });
      return { success: false, error };
    }

    const settings = await getSettings();
    const result = await analyzeYouTubeVideo(url, {
      model: settings.model,
      customPrompt: settings.customPrompt,
    });

    const videoId = extractVideoId(url);
    const savedEntry = await saveAnalysis({
      videoId,
      title: extractTitle(tab, videoId),
      url,
      markdown: result.markdown,
      model: result.model,
      estimatedTokens: result.usage.totalTokens,
      estimatedCost: result.estimatedCost,
    });

    notifyPopup({ action: "analysisComplete", result: savedEntry });
    return { success: true, result: savedEntry };
  } catch (error) {
    const normalized = normalizeError(error);
    notifyPopup({ action: "analysisError", url, error: normalized });
    return { success: false, error: normalized };
  } finally {
    analysesInProgress.delete(url);
  }
}

// ---------------------------------------------------------------------
// seekTo 중계 처리
// ---------------------------------------------------------------------

/**
 * message.videoId가 열려있는 YouTube 탭을 찾는다. (여러 개면 활성 탭을 우선)
 */
async function findTabForVideo(videoId) {
  if (!videoId) return null;
  const tabs = await chrome.tabs.query({ url: "https://www.youtube.com/watch*" });
  const matching = tabs.filter((t) => extractVideoId(t.url ?? "") === videoId);
  if (matching.length === 0) return null;
  return matching.find((t) => t.active) ?? matching[0];
}

/**
 * seekTo 요청을 실제 YouTube 탭의 content.js로 전달한다.
 *
 * - message.tabId가 주어지면 그 탭을 그대로 사용한다.
 * - message.videoId가 주어지면, 그 영상이 열려있는 탭을 직접 찾아서 사용한다.
 *   (팝업에서 보고 있는 리포트가 지금 활성 탭의 영상과 다를 수 있으므로, 무작정
 *   활성 탭에 쏘면 엉뚱한 영상이 탐색될 수 있다 — 반드시 videoId로 실제 탭을 확인한다.)
 * - 위 두 경우 모두 아니면(=힌트 없음) 현재 창의 활성 탭을 사용한다.
 */
async function handleSeekTo(message) {
  let targetTabId = message.tabId;

  if (targetTabId === undefined && message.videoId) {
    const matchedTab = await findTabForVideo(message.videoId);
    if (!matchedTab) {
      return {
        success: false,
        error: {
          code: "VIDEO_TAB_NOT_FOUND",
          message: "이 영상이 열려있는 YouTube 탭을 찾을 수 없습니다. 먼저 해당 영상 페이지를 열어주세요.",
        },
      };
    }
    targetTabId = matchedTab.id;
  }

  if (targetTabId === undefined) {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab) {
      return { success: false, error: { code: "NO_ACTIVE_TAB", message: "활성 탭을 찾을 수 없습니다." } };
    }
    targetTabId = activeTab.id;
  }

  return new Promise((resolve) => {
    chrome.tabs.sendMessage(targetTabId, { action: "seekTo", seconds: message.seconds }, (response) => {
      if (chrome.runtime.lastError) {
        resolve({
          success: false,
          error: { code: "TAB_UNREACHABLE", message: chrome.runtime.lastError.message },
        });
        return;
      }
      resolve(response ?? { success: false, error: { code: "NO_RESPONSE", message: "content script로부터 응답이 없습니다." } });
    });
  });
}

// ---------------------------------------------------------------------
// 메시지 라우팅
// ---------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.action !== "string") return false;

  switch (message.action) {
    case "analyzeVideo":
      handleAnalyzeVideo(message.url, sender.tab).then(sendResponse);
      return true; // 비동기 응답

    case "seekTo":
      handleSeekTo(message).then(sendResponse);
      return true; // 비동기 응답

    default:
      return false;
  }
});
