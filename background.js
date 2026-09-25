// ViewDigest - background service worker
//
// content.js / popup.js 로부터 오는 메시지를 받아 실제 분석 파이프라인을 조율한다.
// manifest.json의 background.type이 "module"이므로 ES import를 사용할 수 있다.

import { analyzeYouTubeVideo, GeminiApiError } from "./utils/gemini.js";
import { checkRateLimit, getDateKey } from "./utils/cost.js";
import {
  getSettings,
  setSettings,
  saveAnalysis,
  getHistory,
  patchHistoryEntries,
  removeDuplicateHistory,
  getAnalysesInProgress,
  addChannelFailure,
  mutateChannel,
  getChannels,
  updateChannel,
  addUnseenId,
} from "./utils/storage.js";
import { fetchLatestVideos, fetchVideoChannelName } from "./utils/channels.js";
import { t } from "./utils/i18n.js";
import { refreshBadge } from "./utils/badge.js";
import { recordSuccessfulAnalysis } from "./utils/review.js";

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

// 채널 자동 분석을 막는 원인 중, 영상마다가 아니라 전체에 걸리는 것. 채널·영상마다
// 알리면 알림이 쏟아지므로 하루 한 번만 알리고, 기준선을 전진시키지 않아 원인이
// 해결된 뒤 다음 확인 때 같은 영상부터 다시 분석한다.
const BLOCKING_ERROR_CODES = ["RATE_LIMITED", "MISSING_API_KEY"];
const NOTICE_DATES_KEY = "blockingNoticeDates";

// 지금은 실패했지만 시간이 지나면 풀릴 수 있는 실패. 업로드 직후 처리 중이거나 아직 공개 전인
// 프리미어·라이브라 Gemini가 영상을 못 가져오는 경우(403), 서버 과부하(429·5xx), 네트워크
// 오류가 그렇다. 이런 영상은 바로 포기하지 않고 이 시간 동안 확인할 때마다 다시 시도한다.
// 거부된 요청은 분석이 이뤄지지 않았으므로 일일 한도에도 세지 않는다.
const RETRY_WINDOW_MS = 24 * 60 * 60 * 1000;
const RETRYABLE_HTTP_STATUSES = [429, 500, 502, 503, 504];

function isRetryableFailure(error) {
  if (error?.code === "VIDEO_NOT_ACCESSIBLE") return true;
  if (error?.code !== "REQUEST_FAILED") return false;
  // 상태 코드가 없으면 응답을 받기 전에 끊긴 것(네트워크 오류 등)이다.
  return error.status === undefined || RETRYABLE_HTTP_STATUSES.includes(error.status);
}

// 알림 id 접두어. 알림을 눌렀을 때 무엇을 열지 id로 구분한다.
const NOTIFICATION_PREFIX = {
  ENTRY: "viewdigest-entry:", // 분석 완료 → 그 리포트
  SETUP: "viewdigest-setup:", // API 키 없음·한도 초과 → 설정 페이지
  VIDEO: "viewdigest-video:", // 그 밖의 실패 → YouTube 영상(버튼으로 다시 시도)
};

// ---------------------------------------------------------------------
// 설치/업데이트/시작 초기화
// ---------------------------------------------------------------------

/**
 * 채널 확인 알람을 등록한다. 브라우저를 켤 때나 확장프로그램을 업데이트할 때마다
 * 새로 만들면 다음 확인이 그때부터 다시 한 주기 뒤로 밀리므로, 같은 주기의 알람이
 * 이미 있으면 그대로 둔다. 사용자가 주기를 바꿨을 때만(reschedule) 새로 잡는다.
 */
async function setupChannelCheckAlarm({ reschedule = false } = {}) {
  const settings = await getSettings();
  const interval = settings.channelCheckIntervalMinutes ?? DEFAULT_CHANNEL_CHECK_INTERVAL_MINUTES;
  const existing = await chrome.alarms.get(CHANNEL_CHECK_ALARM_NAME);
  if (!reschedule && existing?.periodInMinutes === interval) return;
  await chrome.alarms.create(CHANNEL_CHECK_ALARM_NAME, {
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
  await removeDuplicateHistory();
  await refreshBadge();
  await backfillChannelTitles();
});

// 서비스 워커가 유휴 상태에서 깨어날 때(브라우저 재시작 등)도 알람이 등록되어 있는지 보장한다.
// 배지 글자는 브라우저를 다시 켜면 지워지므로 저장된 개수로 다시 그린다.
chrome.runtime.onStartup.addListener(async () => {
  setupChannelCheckAlarm();
  await removeDuplicateHistory();
  refreshBadge();
  backfillChannelTitles();
});

/**
 * 채널 이름을 저장하지 않던 버전에서 만든 히스토리 항목에 채널 이름을 채워 넣는다.
 * YouTube가 모른다고 답한 항목(비공개·삭제된 영상)은 null로 남겨 다시 묻지 않고,
 * 네트워크 오류로 못 알아낸 항목은 그대로 두어 다음 기회에 다시 시도한다.
 */
async function backfillChannelTitles() {
  const missing = (await getHistory()).filter((entry) => entry.channelTitle === undefined && entry.url);
  if (missing.length === 0) return;

  const patches = new Map();
  for (const entry of missing) {
    const channelTitle = await fetchVideoChannelName(entry.url);
    if (channelTitle !== undefined) patches.set(entry.id, { channelTitle });
  }
  if (patches.size > 0) await patchHistoryEntries(patches);
}

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
  if (!rawTitle) return videoId ?? t("untitled");
  return rawTitle.replace(/\s*-\s*YouTube\s*$/, "").trim() || (videoId ?? t("untitled"));
}

/**
 * GeminiApiError(또는 그 외 예외)를 popup/content로 전달할 수 있는
 * { code, message } 형태로 정규화한다.
 */
function normalizeError(error) {
  if (error instanceof GeminiApiError) {
    return { code: error.code, message: error.message, status: error.details?.status };
  }
  return { code: "UNKNOWN_ERROR", message: error?.message ?? t("unknownError") };
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

async function handleAnalyzeVideo(url, { tab, titleOverride, channelTitle } = {}) {
  // has() 확인과 add()를 그 사이에 await 없이(동기적으로) 수행해야, 거의 동시에
  // 들어온 두 번째 analyzeVideo 요청이 첫 번째 요청의 등록을 확실히 보고 걸러진다.
  // (add()를 비동기 작업 뒤로 미루면 그 틈에 두 요청이 모두 통과하는 경쟁 조건이 생긴다.)
  if (analysesInProgress.has(url)) {
    return { success: false, error: { code: "ALREADY_ANALYZING", message: t("bgAlreadyAnalyzing") } };
  }
  analysesInProgress.add(url);

  try {
    // gemini.js도 내부적으로 checkRateLimit()을 호출하지만, 여기서 먼저 확인하면
    // 불필요한 설정 조회/API 호출 준비 없이 빠르게 실패할 수 있다.
    const rateLimit = await checkRateLimit();
    if (!rateLimit.allowed) {
      const error = {
        code: "RATE_LIMITED",
        message: t("rateLimited", rateLimit.limit),
      };
      notifyPopup({ action: "analysisError", url, error });
      return { success: false, error };
    }

    const settings = await getSettings();
    const result = await analyzeYouTubeVideo(url, {
      model: settings.model,
      customPrompt: settings.customPrompt,
      reportLanguage: settings.reportLanguage,
    });

    const videoId = extractVideoId(url);
    const savedEntry = await saveAnalysis({
      videoId,
      title: titleOverride ?? extractTitle(tab, videoId),
      channelTitle,
      url,
      markdown: result.markdown,
      model: result.model,
      estimatedTokens: result.usage.totalTokens,
      estimatedCost: result.estimatedCost,
    });

    await recordSuccessfulAnalysis();
    notifyPopup({ action: "analysisComplete", result: savedEntry });
    return { success: true, result: savedEntry };
  } catch (error) {
    // 서비스 워커 콘솔(chrome://extensions → 세부정보 → 서비스 워커 검사)에서
    // Google이 보낸 원본 에러 본문까지 확인할 수 있도록 전체 에러를 남긴다.
    // Gemini가 거절한 경우(접근 불가·한도 등)는 알림·설정 화면으로 이미 알리는 예상된 실패라
    // console.error로 남기지 않는다. error로 남기면 확장프로그램 관리 페이지에 "오류"로 쌓여
    // 라이브 영상 재시도처럼 30분마다 되풀이되는 실패가 확장프로그램 고장처럼 보인다.
    const log = error instanceof GeminiApiError ? console.log : console.error;
    log("[analyzeVideo 실패]", url, error, error?.details ?? "");
    const normalized = normalizeError(error);
    notifyPopup({ action: "analysisError", url, error: normalized });
    return { success: false, error: normalized };
  } finally {
    analysesInProgress.delete(url);
  }
}

// ---------------------------------------------------------------------
// 분석 결과 탭 열기 (content.js의 분석 버튼 클릭)
// ---------------------------------------------------------------------

/**
 * content.js의 분석 버튼 클릭을 받아, 실제 분석은 results/results.html이
 * 직접 수행하도록 그 페이지를 새 탭으로 연다. 스트리밍 진행 상황을 보여줘야
 * 하므로, 분석 자체를 여기서 기다리지 않고 탭만 열어준다.
 */
async function handleOpenResultsTab(url, { tab } = {}) {
  const videoId = extractVideoId(url);
  const title = extractTitle(tab, videoId);

  const resultsUrl = new URL(chrome.runtime.getURL("results/results.html"));
  resultsUrl.searchParams.set("url", url);
  resultsUrl.searchParams.set("title", title);

  await chrome.tabs.create({ url: resultsUrl.toString() });
  return { success: true };
}

// ---------------------------------------------------------------------
// 리포트의 ▶ 시각 버튼: 영상의 그 장면으로 이동
// ---------------------------------------------------------------------

/**
 * 리포트가 다루는 영상을 그 시각부터 보여준다.
 *
 * - 그 영상이 열려 있는 YouTube 탭이 있으면 그 탭으로 전환해 content.js가 재생 위치를
 *   옮긴다. 반드시 영상 ID로 탭을 고른다. 활성 탭에 무작정 보내면 다른 영상이 이동될 수
 *   있다(예전 구현에서 실제로 있었던 버그).
 * - 탭은 있지만 content.js가 답하지 않으면(확장프로그램 설치·업데이트 전에 열린 탭 등)
 *   그 탭을 시각이 붙은 주소로 다시 연다.
 * - 열린 탭이 없으면 그 시각에서 시작하는 새 탭을 연다.
 */
async function handleSeekVideo(url, seconds) {
  const videoId = extractVideoId(url);
  if (!videoId || !Number.isFinite(seconds) || seconds < 0) return { success: false };
  const start = Math.floor(seconds);
  const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&t=${start}s`;

  const tabs = await chrome.tabs.query({ url: "https://www.youtube.com/watch*" });
  const matching = tabs.filter((tab) => extractVideoId(tab.url ?? "") === videoId);
  const tab = matching.find((t) => t.active) ?? matching.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0];

  if (!tab) {
    await chrome.tabs.create({ url: watchUrl });
    return { success: true, opened: "new-tab" };
  }

  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
  const response = await chrome.tabs
    .sendMessage(tab.id, { action: "seekTo", seconds: start })
    .catch(() => null);
  if (response?.success) return { success: true, opened: "existing-tab" };

  await chrome.tabs.update(tab.id, { url: watchUrl });
  return { success: true, opened: "reloaded-tab" };
}

// ---------------------------------------------------------------------
// 채널 구독: 새 영상 자동 감지/분석
// ---------------------------------------------------------------------

function showNotification(id, title, message) {
  chrome.notifications.create(id, { type: "basic", iconUrl: "icons/icon128.png", title, message });
}

async function notifyNewVideoAnalyzed(channel, video, entryId) {
  await addUnseenId(entryId);
  await refreshBadge();
  showNotification(
    `${NOTIFICATION_PREFIX.ENTRY}${entryId}`,
    t("bgNotificationTitle"),
    `${channel.title}\n${video.title}`
  );
}

/**
 * API 키 없음·한도 초과는 하루에 한 번만 알린다(같은 날 같은 원인이면 조용히 넘어감).
 */
async function notifyBlockingErrorOncePerDay(error) {
  const today = getDateKey();
  const { [NOTICE_DATES_KEY]: dates = {} } = await chrome.storage.local.get(NOTICE_DATES_KEY);
  if (dates[error.code] === today) return;
  await chrome.storage.local.set({ [NOTICE_DATES_KEY]: { ...dates, [error.code]: today } });

  const id = `${NOTIFICATION_PREFIX.SETUP}${error.code}`;
  if (error.code === "RATE_LIMITED") {
    const { limit } = await checkRateLimit();
    showNotification(id, t("bgRateLimitedTitle"), t("bgRateLimitedBody", limit));
  } else {
    showNotification(id, t("bgAnalysisFailedTitle"), t("bgMissingKeyBody"));
  }
}

function notifyVideoFailed(channel, video, error) {
  showNotification(
    `${NOTIFICATION_PREFIX.VIDEO}${video.videoId}`,
    t("bgAnalysisFailedTitle"),
    `${channel.title} · ${video.title}\n${error.message}`
  );
}

chrome.notifications.onClicked.addListener((notificationId) => {
  chrome.notifications.clear(notificationId);

  if (notificationId.startsWith(NOTIFICATION_PREFIX.ENTRY)) {
    // 결과 탭이 열리면서 그 항목을 "확인함"으로 표시하고 배지를 줄인다.
    const entryId = notificationId.slice(NOTIFICATION_PREFIX.ENTRY.length);
    const url = new URL(chrome.runtime.getURL("results/results.html"));
    url.searchParams.set("entryId", entryId);
    chrome.tabs.create({ url: url.toString() });
  } else if (notificationId.startsWith(NOTIFICATION_PREFIX.SETUP)) {
    chrome.runtime.openOptionsPage();
  } else if (notificationId.startsWith(NOTIFICATION_PREFIX.VIDEO)) {
    const videoId = notificationId.slice(NOTIFICATION_PREFIX.VIDEO.length);
    chrome.tabs.create({ url: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}` });
  }
});

// 기준 영상을 찾기 위해 한 번에 살펴보는 최신 영상 수. 분석은 이 중 최대
// MAX_NEW_VIDEOS_PER_CHECK개만 한다.
const VIDEOS_TO_SCAN = 15;

/**
 * 채널 하나의 최신 영상 목록을 확인해, 구독 등록 이후 새로 올라온 영상만 자동 분석한다.
 *
 * - lastVideoId가 없으면(=방금 구독) 지금 최신 영상을 기준선으로만 저장하고,
 *   그 영상 자체는 분석하지 않는다. (구독 즉시 과거 영상까지 소급 분석되는 것을 방지)
 * - 한도 초과(RATE_LIMITED)나 API 키 없음(MISSING_API_KEY)으로 실패하면 그 영상부터는
 *   기준선을 전진시키지 않아, 원인이 풀린 뒤 다음 확인 때 같은 영상부터 다시 시도한다.
 *   이 둘은 하루 한 번만 알린다.
 * - 그 외 사유로 분석에 실패한 영상은 계속 재시도해도 성공할 가능성이 낮으므로 건너뛰고,
 *   영상마다 실패를 알린다.
 * - 영상 하나를 처리할 때마다 기준선을 바로 저장한다. 분석은 한 건에 몇 분씩 걸리므로,
 *   끝에서 한 번에 저장하면 도중에 확인이 끊겼을 때 이미 분석한 영상이 다음 확인에서
 *   다시 분석된다(같은 리포트가 주기마다 쌓이고 비용도 매번 나간다).
 * - 이미 히스토리에 있는 영상(직접 분석했거나 전에 자동 분석한 영상)은 다시 분석하지
 *   않고 건너뛴다. 어떤 이유로 기준선이 어긋나도 같은 영상에 두 번 비용이 들지 않게 한다.
 * - RSS가 막혀 채널 "동영상" 탭에서 읽은 경우, 그 목록에는 쇼츠·라이브가 없어 기준 영상이
 *   빠져 있을 수 있다. 이때 "전부 새 영상"으로 보면 예전 영상까지 분석해 비용이 나가므로,
 *   분석하지 않고 기준선만 지금 최신 영상으로 다시 잡는다.
 */
async function checkChannel(channel) {
  const { source, videos } = await fetchLatestVideos(channel.channelId, VIDEOS_TO_SCAN);
  const now = new Date().toISOString();
  await updateChannel(channel.channelId, {
    lastCheckedAt: now,
    lastSuccessAt: now,
    lastCheckError: null,
    lastCheckSource: source,
  });
  if (videos.length === 0) return;

  if (!channel.lastVideoId) {
    await updateChannel(channel.channelId, { lastVideoId: videos[0].videoId });
    return;
  }

  const lastIndex = videos.findIndex((v) => v.videoId === channel.lastVideoId);
  if (lastIndex === -1 && source === "page") {
    console.warn(`[채널 기준선 재설정] ${channel.title}: 기준 영상이 채널 페이지 목록에 없음`);
    await updateChannel(channel.channelId, { lastVideoId: videos[0].videoId });
    return;
  }
  // RSS에 lastVideoId가 없다면(그 사이 매우 많은 영상이 올라온 경우) 전부 새 영상으로 간주한다.
  const newVideos = lastIndex === -1 ? videos : videos.slice(0, lastIndex);
  if (newVideos.length === 0) return;

  // 업로드 순서(오래된 것부터)대로 분석해 히스토리 순서가 자연스럽게 유지되도록 한다.
  const toAnalyze = newVideos.slice(0, MAX_NEW_VIDEOS_PER_CHECK).reverse();

  const advanceTo = (video) => updateChannel(channel.channelId, { lastVideoId: video.videoId });

  for (const video of toAnalyze) {
    // 사용자가 결과 탭에서 같은 영상을 지금 분석 중이면 끝날 때까지 미룬다(기준선을 두면
    // 다음 확인에서 다시 만나고, 그때는 히스토리에 있어서 건너뛴다).
    if ((await getAnalysesInProgress())[video.videoId]) {
      console.warn(`[직접 분석 중인 영상, 다음 확인으로 미룸] ${channel.title}: ${video.title}`);
      break;
    }

    const history = await getHistory();
    if (history.some((entry) => entry.videoId === video.videoId)) {
      console.warn(`[이미 분석한 영상 건너뜀] ${channel.title}: ${video.title}`);
      await advanceTo(video);
      continue;
    }

    const response = await handleAnalyzeVideo(video.url, {
      titleOverride: video.title,
      channelTitle: channel.title,
    });
    if (response.success) {
      await advanceTo(video);
      await notifyNewVideoAnalyzed(channel, video, response.result.id);
    } else if (BLOCKING_ERROR_CODES.includes(response.error?.code)) {
      await notifyBlockingErrorOncePerDay(response.error);
      break;
    } else {
      await advanceTo(video);
      // 다른 확인이 같은 영상을 이미 분석 중이면 실패가 아니다. 그쪽이 결과를 알린다.
      if (response.error?.code === "ALREADY_ANALYZING") continue;
      // 시간이 지나면 풀릴 수 있는 실패는 재시도 목록으로 옮긴다(알림은 최종 실패 때만).
      if (isRetryableFailure(response.error)) await queueRetry(channel, video, response.error);
      else await giveUpOnVideo(channel, video, response.error);
    }
  }
}

// 자동 분석 한 건은 Gemini 응답을 몇 분씩 기다린다. 그동안 확장 API 호출이 없으면 Chrome이
// 서비스 워커를 유휴 상태로 보고 종료해 분석이 도중에 끊길 수 있으므로, 채널 확인이 도는
// 동안 20초마다 가벼운 확장 API를 불러 깨어 있게 한다.
const KEEP_ALIVE_INTERVAL_MS = 20 * 1000;

async function withKeepAlive(task) {
  const timer = setInterval(() => chrome.runtime.getPlatformInfo(), KEEP_ALIVE_INTERVAL_MS);
  try {
    return await task();
  } finally {
    clearInterval(timer);
  }
}

/**
 * 영상 하나를 포기한다: 설정 화면의 실패 기록에 남기고 알린다.
 */
async function giveUpOnVideo(channel, video, error) {
  await addChannelFailure(channel.channelId, {
    videoId: video.videoId,
    title: video.title,
    url: video.url,
    reason: error?.message ?? t("unknownError"),
    code: error?.code ?? null,
    at: new Date().toISOString(),
  });
  notifyVideoFailed(channel, video, error ?? { message: t("unknownError") });
}

async function queueRetry(channel, video, error) {
  await mutateChannel(channel.channelId, (current) => ({
    pendingRetries: [
      ...(current.pendingRetries ?? []).filter((p) => p.videoId !== video.videoId),
      {
        videoId: video.videoId,
        title: video.title,
        url: video.url,
        firstFailedAt: new Date().toISOString(),
        attempts: 1,
        reason: error?.message ?? null,
      },
    ],
  }));
}

/**
 * 전에 일시적으로 실패한 영상을 다시 시도한다. 성공하면 평소처럼 알리고, 다시 일시적으로
 * 실패하면 24시간이 될 때까지 남겨 두며, 그 밖의 실패나 24시간이 지나면 포기한다.
 */
async function retryPendingVideos(channel) {
  const pending = channel.pendingRetries ?? [];
  if (pending.length === 0) return;

  const history = await getHistory();
  const inProgress = await getAnalysesInProgress();
  const keep = [];
  let blocked = false;

  for (const item of pending) {
    // 그 사이 직접 분석했으면 끝난 것이다.
    if (history.some((entry) => entry.videoId === item.videoId)) continue;
    if (blocked || inProgress[item.videoId]) {
      keep.push(item);
      continue;
    }

    const response = await handleAnalyzeVideo(item.url, {
      titleOverride: item.title,
      channelTitle: channel.title,
    });
    if (response.success) {
      await notifyNewVideoAnalyzed(channel, item, response.result.id);
    } else if (BLOCKING_ERROR_CODES.includes(response.error?.code)) {
      await notifyBlockingErrorOncePerDay(response.error);
      blocked = true; // 한도·키 문제는 모든 영상에 해당하므로 남은 재시도도 다음으로 미룬다.
      keep.push(item);
    } else if (response.error?.code === "ALREADY_ANALYZING") {
      keep.push(item);
    } else if (
      isRetryableFailure(response.error) &&
      Date.now() - Date.parse(item.firstFailedAt) < RETRY_WINDOW_MS
    ) {
      keep.push({ ...item, attempts: item.attempts + 1, reason: response.error?.message ?? item.reason });
    } else {
      await giveUpOnVideo(channel, item, response.error);
    }
  }

  // 그 사이 checkChannel 등이 추가한 항목을 잃지 않도록 최신 목록 기준으로 합친다.
  const handled = new Set(pending.map((p) => p.videoId));
  await mutateChannel(channel.channelId, (current) => ({
    pendingRetries: [...(current.pendingRetries ?? []).filter((p) => !handled.has(p.videoId)), ...keep],
  }));
}

async function checkAllChannels() {
  const channels = await getChannels();
  for (const channel of channels.filter((c) => c.enabled)) {
    try {
      await retryPendingVideos(channel);
      await checkChannel(channel);
    } catch (error) {
      // 한 채널의 네트워크 오류 등이 나머지 채널 확인을 막지 않도록 채널별로 격리한다.
      // 실패도 시각과 사유를 남겨, 설정 화면에서 "확인이 멈춘 것"과 구분되게 한다.
      // 사유는 설정 화면의 채널 목록에 표시되므로 관리 페이지의 "오류"로는 남기지 않는다.
      console.log(`[채널 확인 실패] ${channel.title ?? channel.channelId}:`, error);
      const patch = {
        lastCheckedAt: new Date().toISOString(),
        lastCheckError: error?.message ?? String(error),
      };
      // 예전 버전은 성공했을 때만 lastCheckedAt을 남겼다. 그 값을 덮어쓰기 전에 마지막
      // 성공 시각으로 옮겨 둔다(업데이트 직후 첫 실패에서 성공 기록이 사라지지 않게).
      if (!channel.lastSuccessAt && !channel.lastCheckError && channel.lastCheckedAt) {
        patch.lastSuccessAt = channel.lastCheckedAt;
      }
      await updateChannel(channel.channelId, patch);
    }
  }
}

// 채널 확인은 한 번에 하나만 돈다. 확인이 길어지는 동안 다음 알람이 오거나 "지금 확인"을 누르면
// 새로 시작하지 않고 진행 중인 확인을 함께 기다린다(겹쳐 돌면 요청과 keep-alive가 쌓인다).
let channelCheckRun = null;

function runChannelCheck() {
  channelCheckRun ??= withKeepAlive(checkAllChannels).finally(() => {
    channelCheckRun = null;
  });
  return channelCheckRun;
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === CHANNEL_CHECK_ALARM_NAME) {
    runChannelCheck();
  }
});

// ---------------------------------------------------------------------
// 메시지 라우팅
// ---------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.action !== "string") return false;

  switch (message.action) {
    case "seekVideo":
      handleSeekVideo(message.url, Number(message.seconds))
        .then(sendResponse)
        .catch((error) => sendResponse({ success: false, error: normalizeError(error) }));
      return true; // 비동기 응답

    case "openResultsTab":
      handleOpenResultsTab(message.url, { tab: sender.tab })
        .then(sendResponse)
        .catch((error) => sendResponse({ success: false, error: normalizeError(error) }));
      return true; // 비동기 응답

    case "checkChannelsNow":
      runChannelCheck()
        .then(() => sendResponse({ success: true }))
        .catch((error) => sendResponse({ success: false, error: normalizeError(error) }));
      return true; // 비동기 응답

    case "refreshChannelCheckAlarm":
      setupChannelCheckAlarm({ reschedule: true }).then(() => sendResponse({ success: true }));
      return true; // 비동기 응답

    default:
      return false;
  }
});
