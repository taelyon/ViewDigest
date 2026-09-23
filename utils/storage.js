// ViewDigest - chrome.storage.local 래퍼

const STORAGE_KEYS = {
  HISTORY: "analysisHistory",
  SETTINGS: "settings",
  CHANNELS: "subscribedChannels",
  UNSEEN: "unseenAutoAnalysisIds",
  IN_PROGRESS: "manualAnalysesInProgress",
};

// 결과 탭이 분석 도중 닫히면 "진행 중" 표시가 남는다. 이보다 오래된 표시는 무시한다.
const IN_PROGRESS_TTL_MS = 15 * 60 * 1000;

const MAX_HISTORY_ITEMS = 50;

function generateId() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `analysis_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 저장된 사용자 설정을 조회 (API 키, 모델, 일일 분석 한도 등)
 */
async function getSettings() {
  const { [STORAGE_KEYS.SETTINGS]: settings } = await chrome.storage.local.get(
    STORAGE_KEYS.SETTINGS
  );
  return settings ?? {};
}

/**
 * 사용자 설정을 기존 값과 병합하여 저장
 */
async function setSettings(settings) {
  const current = await getSettings();
  const merged = { ...current, ...settings };
  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: merged });
  return merged;
}

/**
 * 저장된 분석 결과 히스토리를 최신순으로 조회
 */
async function getHistory() {
  const { [STORAGE_KEYS.HISTORY]: history } = await chrome.storage.local.get(
    STORAGE_KEYS.HISTORY
  );
  return history ?? [];
}

/**
 * 분석 결과를 히스토리 맨 앞에 저장하고, 최대 개수를 넘으면 오래된 항목부터 삭제.
 * 히스토리에는 영상 하나당 한 항목만 둔다. 같은 영상을 다시 분석하면 이전 결과를 새 결과로 바꾼다.
 */
async function saveAnalysis(result) {
  const entry = {
    id: result.id ?? generateId(),
    videoId: result.videoId,
    title: result.title,
    // 채널 이름을 알아내지 못했으면 undefined로 둔다(저장되지 않음). 나중에 다시 채울 수 있다.
    channelTitle: result.channelTitle,
    url: result.url,
    markdown: result.markdown,
    createdAt: result.createdAt ?? new Date().toISOString(),
    model: result.model,
    estimatedTokens: result.estimatedTokens,
    estimatedCost: result.estimatedCost,
  };

  const history = await getHistory();
  const others = entry.videoId ? history.filter((item) => item.videoId !== entry.videoId) : history;
  const updated = [entry, ...others].slice(0, MAX_HISTORY_ITEMS);
  await chrome.storage.local.set({ [STORAGE_KEYS.HISTORY]: updated });
  return entry;
}

/**
 * 같은 영상의 항목이 여러 개면 가장 최근 것만 남긴다(한 영상당 한 항목 규칙 이전에 쌓인 중복 정리).
 * @returns {Promise<number>} 지운 항목 수
 */
async function removeDuplicateHistory() {
  const history = await getHistory();
  const seen = new Set();
  const kept = history.filter((entry) => {
    if (!entry.videoId) return true;
    if (seen.has(entry.videoId)) return false;
    seen.add(entry.videoId);
    return true;
  });
  if (kept.length !== history.length) {
    await chrome.storage.local.set({ [STORAGE_KEYS.HISTORY]: kept });
  }
  return history.length - kept.length;
}

/**
 * 결과 탭에서 직접 분석 중인 영상. 채널 자동 분석이 같은 영상을 동시에 분석해
 * 비용이 두 번 나가지 않도록, 자동 분석은 이 목록에 있는 영상을 다음 확인으로 미룬다.
 */
async function getAnalysesInProgress() {
  const { [STORAGE_KEYS.IN_PROGRESS]: map } = await chrome.storage.local.get(STORAGE_KEYS.IN_PROGRESS);
  const now = Date.now();
  return Object.fromEntries(
    Object.entries(map ?? {}).filter(([, startedAt]) => now - startedAt < IN_PROGRESS_TTL_MS)
  );
}

async function setAnalysisInProgress(videoId, inProgress) {
  const map = await getAnalysesInProgress();
  if (inProgress) map[videoId] = Date.now();
  else delete map[videoId];
  await chrome.storage.local.set({ [STORAGE_KEYS.IN_PROGRESS]: map });
}

/**
 * 여러 히스토리 항목을 id별로 부분 수정한다. patches: Map<id, patch>
 * 그 사이 삭제된 항목은 건드리지 않는다.
 */
async function patchHistoryEntries(patches) {
  const history = await getHistory();
  const updated = history.map((entry) =>
    patches.has(entry.id) ? { ...entry, ...patches.get(entry.id) } : entry
  );
  await chrome.storage.local.set({ [STORAGE_KEYS.HISTORY]: updated });
}

/**
 * id로 특정 분석 결과를 히스토리에서 삭제
 */
async function deleteAnalysis(id) {
  const history = await getHistory();
  const updated = history.filter((item) => item.id !== id);
  await chrome.storage.local.set({ [STORAGE_KEYS.HISTORY]: updated });
  return updated;
}

/**
 * 히스토리 전체 삭제
 */
async function clearHistory() {
  await chrome.storage.local.set({ [STORAGE_KEYS.HISTORY]: [] });
}

/**
 * 구독 중인 채널 목록을 조회
 */
async function getChannels() {
  const { [STORAGE_KEYS.CHANNELS]: channels } = await chrome.storage.local.get(
    STORAGE_KEYS.CHANNELS
  );
  return channels ?? [];
}

/**
 * 채널을 구독 목록에 추가한다. 이미 등록된 channelId면 아무것도 하지 않고
 * 기존 항목을 그대로 반환한다.
 */
async function addChannel(channel) {
  const channels = await getChannels();
  const existing = channels.find((c) => c.channelId === channel.channelId);
  if (existing) return existing;

  const entry = {
    channelId: channel.channelId,
    title: channel.title ?? channel.channelId,
    url: channel.url ?? `https://www.youtube.com/channel/${channel.channelId}`,
    enabled: true,
    addedAt: new Date().toISOString(),
    // 등록 시점의 최신 영상을 기준선으로 삼아, 그 이후 올라온 영상만 자동 분석 대상이 된다.
    lastVideoId: channel.lastVideoId ?? null,
    lastCheckedAt: null,
  };

  await chrome.storage.local.set({ [STORAGE_KEYS.CHANNELS]: [...channels, entry] });
  return entry;
}

/**
 * channelId로 채널을 구독 목록에서 제거
 */
async function removeChannel(channelId) {
  const channels = await getChannels();
  const updated = channels.filter((c) => c.channelId !== channelId);
  await chrome.storage.local.set({ [STORAGE_KEYS.CHANNELS]: updated });
  return updated;
}

/**
 * channelId로 채널 항목을 부분 수정(활성화 여부, lastVideoId 등)
 */
async function updateChannel(channelId, patch) {
  const channels = await getChannels();
  const updated = channels.map((c) => (c.channelId === channelId ? { ...c, ...patch } : c));
  await chrome.storage.local.set({ [STORAGE_KEYS.CHANNELS]: updated });
  return updated.find((c) => c.channelId === channelId) ?? null;
}

/**
 * 채널 자동 분석으로 생겼지만 사용자가 아직 확인하지 않은 히스토리 항목 id 목록.
 * 툴바 아이콘 배지 숫자와 팝업의 NEW 표시가 이 목록을 쓴다.
 */
async function getUnseenIds() {
  const { [STORAGE_KEYS.UNSEEN]: ids } = await chrome.storage.local.get(STORAGE_KEYS.UNSEEN);
  return ids ?? [];
}

async function setUnseenIds(ids) {
  await chrome.storage.local.set({ [STORAGE_KEYS.UNSEEN]: ids });
}

async function addUnseenId(id) {
  const ids = await getUnseenIds();
  if (!ids.includes(id)) await setUnseenIds([...ids, id]);
}

async function removeUnseenIds(idsToRemove) {
  const ids = await getUnseenIds();
  const remaining = ids.filter((id) => !idsToRemove.includes(id));
  if (remaining.length !== ids.length) await setUnseenIds(remaining);
}

export {
  STORAGE_KEYS,
  MAX_HISTORY_ITEMS,
  getSettings,
  setSettings,
  getHistory,
  saveAnalysis,
  removeDuplicateHistory,
  getAnalysesInProgress,
  setAnalysisInProgress,
  patchHistoryEntries,
  deleteAnalysis,
  clearHistory,
  getChannels,
  addChannel,
  removeChannel,
  updateChannel,
  getUnseenIds,
  setUnseenIds,
  addUnseenId,
  removeUnseenIds,
};
