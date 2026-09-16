// ViewDigest - chrome.storage.local 래퍼

const STORAGE_KEYS = {
  HISTORY: "analysisHistory",
  SETTINGS: "settings",
  CHANNELS: "subscribedChannels",
};

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
 * 분석 결과를 히스토리 맨 앞에 저장하고, 최대 개수를 넘으면 오래된 항목부터 삭제
 */
async function saveAnalysis(result) {
  const entry = {
    id: result.id ?? generateId(),
    videoId: result.videoId,
    title: result.title,
    url: result.url,
    markdown: result.markdown,
    createdAt: result.createdAt ?? new Date().toISOString(),
    model: result.model,
    estimatedTokens: result.estimatedTokens,
    estimatedCost: result.estimatedCost,
  };

  const history = await getHistory();
  const updated = [entry, ...history].slice(0, MAX_HISTORY_ITEMS);
  await chrome.storage.local.set({ [STORAGE_KEYS.HISTORY]: updated });
  return entry;
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

export {
  STORAGE_KEYS,
  MAX_HISTORY_ITEMS,
  getSettings,
  setSettings,
  getHistory,
  saveAnalysis,
  deleteAnalysis,
  clearHistory,
  getChannels,
  addChannel,
  removeChannel,
  updateChannel,
};
