// ViewDigest - background service worker
//
// content.js / popup.js 로부터 오는 메시지를 받아 실제 분석 파이프라인을 조율한다.
// manifest.json의 background.type이 "module"이므로 ES import를 사용할 수 있다.

import { analyzeYouTubeVideo, GeminiApiError } from "./utils/gemini.js";
import { checkRateLimit } from "./utils/cost.js";
import {
  getSettings,
  setSettings,
  saveAnalysis,
  getChannels,
  updateChannel,
} from "./utils/storage.js";
import { fetchLatestVideos } from "./utils/channels.js";

// 동시에 같은 영상이 중복 분석되는 것을 막기 위한 진행 중 URL 집합.
// 서비스 워커가 유휴 상태에서 재시작되면 초기화되지만, 그 경우 이전 요청도
// 이미 끝났거나 의미가 없으므로 메모리 내 Set으로 충분하다.
const analysesInProgress = new Set();

const CHANNEL_CHECK_ALARM_NAME = "checkChannels";
const DEFAULT_CHANNEL_CHECK_INTERVAL_MINUTES = 30;
// 채널 하나를 확인할 때 한 번에 자동 분석할 신규 영상 수 상한.
// 브라우저가 오래 꺼져있다가 켜져서 한 채널에 영상이 왕창 쌓여있어도
// 일일 사용 한도가 한 채널에 전부 소진되지 않도록 막는다.
const MAX_NEW_VIDEOS_PER_CHECK = 3;

// ---------------------------------------------------------------------
// 설치/업데이트/시작 초기화
// ---------------------------------------------------------------------

async function setupChannelCheckAlarm() {
  const settings = await getSettings();
  const interval = settings.channelCheckIntervalMinutes ?? DEFAULT_CHANNEL_CHECK_INTERVAL_MINUTES;
  chrome.alarms.create(CHANNEL_CHECK_ALARM_NAME, {
    periodInMinutes: interval,
    delayInMinutes: interval,
  });
}

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    // 이미 저장된 값을 덮어쓰지 않도록, 없는 설정만 기본값으로 채운다.
    const settings = await getSettings();
    if (settings.dailyLimit === undefined) {
      await setSettings({ dailyLimit: 20 });
    }
  }
  await setupChannelCheckAlarm();
});

// 서비스 워커가 유휴 상태에서 깨어날 때(브라우저 재시작 등)도 알람이 등록되어 있는지 보장한다.
chrome.runtime.onStartup.addListener(() => {
  setupChannelCheckAlarm();
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

async function handleAnalyzeVideo(url, { tab, titleOverride } = {}) {
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
      title: titleOverride ?? extractTitle(tab, videoId),
      url,
      markdown: result.markdown,
      model: result.model,
      estimatedTokens: result.usage.totalTokens,
      estimatedCost: result.estimatedCost,
    });

    notifyPopup({ action: "analysisComplete", result: savedEntry });
    return { success: true, result: savedEntry };
  } catch (error) {
    // 서비스 워커 콘솔(chrome://extensions → 세부정보 → 서비스 워커 검사)에서
    // Google이 보낸 원본 에러 본문까지 확인할 수 있도록 전체 에러를 남긴다.
    console.error("[analyzeVideo 실패]", url, error, error?.details ?? "");
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
// 채널 구독: 새 영상 자동 감지/분석
// ---------------------------------------------------------------------

function notifyNewVideoAnalyzed(channel, video) {
  chrome.notifications.create(`viewdigest-analysis-${video.videoId}`, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: "새 영상 분석 완료",
    message: `${channel.title}\n${video.title}`,
  });
}

/**
 * 채널 하나의 RSS 피드를 확인해, 구독 등록 이후 새로 올라온 영상만 자동 분석한다.
 *
 * - lastVideoId가 없으면(=방금 구독) 지금 최신 영상을 기준선으로만 저장하고,
 *   그 영상 자체는 분석하지 않는다. (구독 즉시 과거 영상까지 소급 분석되는 것을 방지)
 * - RATE_LIMITED로 실패하면 그 영상부터는 기준선을 전진시키지 않아, 다음 확인 때
 *   (한도가 초기화된 뒤) 같은 영상부터 다시 시도한다.
 * - 그 외 사유로 분석에 실패한 영상은 계속 재시도해도 성공할 가능성이 낮으므로 건너뛴다.
 */
async function checkChannel(channel) {
  const videos = await fetchLatestVideos(channel.channelId, MAX_NEW_VIDEOS_PER_CHECK + 1);
  await updateChannel(channel.channelId, { lastCheckedAt: new Date().toISOString() });
  if (videos.length === 0) return;

  if (!channel.lastVideoId) {
    await updateChannel(channel.channelId, { lastVideoId: videos[0].videoId });
    return;
  }

  const lastIndex = videos.findIndex((v) => v.videoId === channel.lastVideoId);
  // lastVideoId가 이번 피드에 없다면(그 사이 매우 많은 영상이 올라온 경우) 전부 새 영상으로 간주한다.
  const newVideos = lastIndex === -1 ? videos : videos.slice(0, lastIndex);
  if (newVideos.length === 0) return;

  // 업로드 순서(오래된 것부터)대로 분석해 히스토리 순서가 자연스럽게 유지되도록 한다.
  const toAnalyze = newVideos.slice(0, MAX_NEW_VIDEOS_PER_CHECK).reverse();

  let advanceTo = channel.lastVideoId;
  for (const video of toAnalyze) {
    const response = await handleAnalyzeVideo(video.url, { titleOverride: video.title });
    if (response.success) {
      advanceTo = video.videoId;
      notifyNewVideoAnalyzed(channel, video);
    } else if (response.error?.code === "RATE_LIMITED") {
      break;
    } else {
      advanceTo = video.videoId;
    }
  }

  if (advanceTo !== channel.lastVideoId) {
    await updateChannel(channel.channelId, { lastVideoId: advanceTo });
  }
}

async function checkAllChannels() {
  const channels = await getChannels();
  for (const channel of channels.filter((c) => c.enabled)) {
    try {
      await checkChannel(channel);
    } catch (error) {
      // 한 채널의 네트워크 오류 등이 나머지 채널 확인을 막지 않도록 채널별로 격리한다.
      console.error(`[채널 확인 실패] ${channel.title ?? channel.channelId}:`, error);
    }
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === CHANNEL_CHECK_ALARM_NAME) {
    checkAllChannels();
  }
});

// ---------------------------------------------------------------------
// 메시지 라우팅
// ---------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.action !== "string") return false;

  switch (message.action) {
    case "analyzeVideo":
      handleAnalyzeVideo(message.url, { tab: sender.tab }).then(sendResponse);
      return true; // 비동기 응답

    case "seekTo":
      handleSeekTo(message).then(sendResponse);
      return true; // 비동기 응답

    case "checkChannelsNow":
      checkAllChannels()
        .then(() => sendResponse({ success: true }))
        .catch((error) => sendResponse({ success: false, error: normalizeError(error) }));
      return true; // 비동기 응답

    case "refreshChannelCheckAlarm":
      setupChannelCheckAlarm().then(() => sendResponse({ success: true }));
      return true; // 비동기 응답

    default:
      return false;
  }
});
