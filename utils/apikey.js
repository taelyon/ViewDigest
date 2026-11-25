// View Digest - Gemini API 키 저장·확인
//
// 설정 페이지와 시작 가이드(환영 페이지)가 함께 쓴다. API 키는 기기 간 동기화되는
// chrome.storage.sync에 두므로, 로컬 설정·히스토리를 다루는 storage.js와 따로 둔다.
// gemini.js도 같은 키 이름을 읽는다.

const API_KEY_STORAGE_KEY = "geminiApiKey";

async function getApiKey() {
  const { [API_KEY_STORAGE_KEY]: key } = await chrome.storage.sync.get(API_KEY_STORAGE_KEY);
  return key;
}

async function setApiKey(key) {
  await chrome.storage.sync.set({ [API_KEY_STORAGE_KEY]: key });
}

/** 화면에 보여 줄 때는 끝 네 글자만 남긴다. */
function maskApiKey(key) {
  if (!key) return "";
  if (key.length <= 4) return "•".repeat(key.length);
  return `${"•".repeat(Math.max(key.length - 4, 4))}${key.slice(-4)}`;
}

/**
 * 키가 쓸 수 있는지 확인한다. 영상을 분석하지 않고 모델 목록만 조회하므로 비용이 들지 않는다.
 * @returns {Promise<{ ok: true } | { ok: false, status?: number }>} status가 없으면 네트워크 오류
 */
async function testApiKey(key) {
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`
    );
    return response.ok ? { ok: true } : { ok: false, status: response.status };
  } catch {
    return { ok: false };
  }
}

export { API_KEY_STORAGE_KEY, getApiKey, setApiKey, maskApiKey, testApiKey };
