// ViewDigest - Gemini API 클라이언트
//
// Gemini의 "Agentic Video Understanding" 기능을 사용해 YouTube 영상 URL을 직접
// 전달하고, 초고밀도 분석 리포트를 생성해서 반환합니다.

import { getSystemInstruction, getUserPrompt } from "./prompt.js";
import { checkRateLimit, estimateCost, recordUsage } from "./cost.js";

// 기본 분석 모델. options.model 로 호출 시 덮어쓸 수 있음
const DEFAULT_MODEL = "gemini-3.7-flash";

// Gemini REST API 엔드포인트 베이스 (모델명 + ":generateContent" 를 붙여 사용)
const API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

// API 키는 storage.js가 다루는 chrome.storage.local(설정/히스토리)과 분리해,
// 기기 간 동기화가 필요한 민감 정보이므로 chrome.storage.sync 에 별도 보관한다.
const API_KEY_STORAGE_KEY = "geminiApiKey";

/**
 * gemini.js에서 발생하는 모든 에러를 구분하기 위한 커스텀 에러 클래스.
 * `code` 필드로 호출부(background.js/popup.js)가 에러 종류에 따라
 * 분기 처리(예: 옵션 페이지로 유도, 재시도 안내 등)할 수 있도록 한다.
 */
class GeminiApiError extends Error {
  constructor(message, code, details) {
    super(message);
    this.name = "GeminiApiError";
    this.code = code;
    this.details = details;
  }
}

const ERROR_CODES = {
  MISSING_API_KEY: "MISSING_API_KEY",
  INVALID_URL: "INVALID_URL",
  RATE_LIMITED: "RATE_LIMITED",
  REQUEST_FAILED: "REQUEST_FAILED",
  EMPTY_RESPONSE: "EMPTY_RESPONSE",
};

/**
 * chrome.storage.sync 에 저장된 Gemini API 키를 조회.
 * options 페이지에서 아직 키를 입력하지 않았다면 undefined를 반환한다.
 */
function getApiKey() {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.get(API_KEY_STORAGE_KEY, (result) => {
      if (chrome.runtime.lastError) {
        reject(
          new GeminiApiError(
            "API 키를 불러오는 중 오류가 발생했습니다.",
            ERROR_CODES.REQUEST_FAILED,
            chrome.runtime.lastError
          )
        );
        return;
      }
      resolve(result[API_KEY_STORAGE_KEY]);
    });
  });
}

/**
 * 아주 단순한 URL 형태 검증. 실제 videoId 파싱 등은 content.js/background.js의
 * 몫이며, 여기서는 명백히 잘못된 입력만 조기에 걸러낸다.
 */
function isLikelyYoutubeUrl(url) {
  return typeof url === "string" && /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//.test(url);
}

/**
 * Gemini generateContent 요청 바디를 구성한다.
 * - systemInstruction / user prompt 는 utils/prompt.js 의 상수를 사용
 * - YouTube 영상은 fileData.fileUri 로 URL을 그대로 전달 (업로드 불필요).
 * - `mediaProcessing: "AGENTIC"` 은 의도적으로 사용하지 않는다. 실제로 켜봤더니
 *   7분짜리 짧은 영상에서도 "입력 토큰이 1,048,576을 초과했다"는 오류가
 *   발생했는데 — 정적(1fps) 처리라면 7분 영상은 낮은 해상도 기준으로도
 *   4~5만 토큰 수준이라 1M을 넘을 수가 없다. Google 문서도 "영상 전체를
 *   빠짐없이 훑어야 하는 질의는 agentic 모드의 이점이 거의 없고, 결국 모델이
 *   전체를 다 훑는다"고 명시하는데, 우리 SYSTEM_INSTRUCTION은 정확히 그런
 *   "빠짐없이 전부 다룰 것"을 요구하는 초고밀도 분석 프롬프트다. 이 조합에서
 *   agentic의 서버사이드 다중 턴 탐색 루프가 매 턴 누적 컨텍스트를 반복
 *   재전송하며 토큰을 기하급수적으로 불려, 짧은 영상조차 한도를 넘긴 것으로
 *   보인다. 따라서 정적 처리를 유지한다.
 * - Google Search 도구는 그대로 전달해, 영상 밖의 최신/실시간 정보(발행일,
 *   채널 맥락 등)로 보강된 분석이 가능하도록 한다. 이건 agentic 모드와
 *   무관하게 별도로 동작하며 토큰 폭증의 원인이 아니다.
 * - `mediaResolution: { level: "media_resolution_low" }` 은 그대로 유지해
 *   프레임당 토큰 사용량을 낮춘다. 정적 처리에서도 아주 긴 영상(수 시간)은
 *   여전히 한도에 가까워질 수 있어, 안전 마진으로 남겨둔다.
 */
function buildRequestBody(youtubeUrl, customPrompt) {
  return {
    systemInstruction: {
      parts: [{ text: getSystemInstruction() }],
    },
    contents: [
      {
        role: "user",
        parts: [
          { text: getUserPrompt(customPrompt) },
          {
            fileData: { fileUri: youtubeUrl, mimeType: "video/mp4" },
            mediaResolution: { level: "media_resolution_low" },
          },
        ],
      },
    ],
    tools: [{ googleSearch: {} }],
  };
}

/**
 * fetch 응답에서 에러를 검사하고, 실패 시 GeminiApiError를 던진다.
 * Google이 응답 본문에 실어 보내는 구체적인 사유(error.message)를 그대로
 * 사용자에게 보여줘야, "HTTP 400" 같은 뜻모를 메시지 대신 실제 원인(예: 잘못된
 * 모델명, 권한 없는 API 키 등)을 바로 알 수 있다.
 */
async function assertOkResponse(response) {
  if (response.ok) return;

  let details;
  try {
    details = await response.json();
  } catch {
    details = await response.text().catch(() => null);
  }

  const apiMessage = typeof details === "object" ? details?.error?.message : null;

  // 영상 길이(+ 해상도) 자체가 Gemini의 입력 토큰 한도를 넘는 경우.
  // mediaResolution을 이미 최저값으로 낮춰도 아주 긴 영상은 여전히 넘을 수
  // 있는데, 이때 원본 메시지("...exceeds the maximum number of tokens...")만
  // 보여주면 사용자가 재시도해도 소용없는 상황임을 알기 어렵다.
  if (apiMessage && /exceeds the maximum number of tokens/i.test(apiMessage)) {
    throw new GeminiApiError(
      "이 영상은 길이가 너무 길어 Gemini가 한 번에 분석할 수 있는 한도(입력 토큰)를 초과합니다. 더 짧은 영상으로 시도해주세요.",
      ERROR_CODES.REQUEST_FAILED,
      { status: response.status, body: details }
    );
  }

  const message = apiMessage
    ? `Gemini API 요청이 실패했습니다: ${apiMessage}`
    : `Gemini API 요청이 실패했습니다. (HTTP ${response.status})`;

  throw new GeminiApiError(message, ERROR_CODES.REQUEST_FAILED, {
    status: response.status,
    body: details,
  });
}

/**
 * Gemini 응답 JSON에서 마크다운 텍스트와 토큰 사용량을 추출한다.
 */
function parseResponse(data) {
  const candidate = data?.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  const markdown = parts
    .map((part) => part.text ?? "")
    .join("")
    .trim();

  if (!markdown) {
    throw new GeminiApiError(
      "Gemini가 빈 응답을 반환했습니다.",
      ERROR_CODES.EMPTY_RESPONSE,
      data
    );
  }

  // usageMetadata는 Gemini API가 실제로 소모한 토큰 수를 알려준다.
  // 값이 없는 예외적인 경우에는 대략적인 추정치로 대체한다.
  const usage = data?.usageMetadata ?? {};
  const inputTokens = usage.promptTokenCount ?? Math.ceil(markdown.length / 4);
  const outputTokens = usage.candidatesTokenCount ?? Math.ceil(markdown.length / 4);
  const totalTokens = usage.totalTokenCount ?? inputTokens + outputTokens;

  return { markdown, inputTokens, outputTokens, totalTokens };
}

/**
 * YouTube 영상을 Gemini Agentic Video Understanding으로 분석한다.
 *
 * @param {string} youtubeUrl 분석할 YouTube 영상 URL
 * @param {object} [options]
 * @param {string} [options.model] 사용할 모델명 (기본값: DEFAULT_MODEL)
 * @param {string} [options.customPrompt] 기본 프롬프트 대신 사용할 커스텀 프롬프트
 * @returns {Promise<{markdown: string, model: string, usage: {inputTokens: number, outputTokens: number, totalTokens: number}, estimatedCost: number}>}
 */
function analyzeYouTubeVideo(youtubeUrl, options = {}) {
  const model = options.model ?? DEFAULT_MODEL;

  if (!isLikelyYoutubeUrl(youtubeUrl)) {
    return Promise.reject(
      new GeminiApiError(
        "올바른 YouTube 영상 URL이 아닙니다.",
        ERROR_CODES.INVALID_URL,
        { youtubeUrl }
      )
    );
  }

  // 1. 호출 전 일일 사용량 제한을 먼저 확인해 불필요한 API 호출을 막는다.
  return checkRateLimit()
    .then((rateLimit) => {
      if (!rateLimit.allowed) {
        throw new GeminiApiError(
          `오늘의 분석 가능 횟수(${rateLimit.limit}회)를 모두 사용했습니다.`,
          ERROR_CODES.RATE_LIMITED,
          rateLimit
        );
      }

      // 2. API 키가 없으면 요청을 보내기 전에 명확한 에러로 안내한다.
      return getApiKey();
    })
    .then((apiKey) => {
      if (!apiKey) {
        throw new GeminiApiError(
          "Gemini API 키가 설정되지 않았습니다. 옵션 페이지에서 먼저 등록해주세요.",
          ERROR_CODES.MISSING_API_KEY
        );
      }

      // 3. 실제 Gemini API 요청
      const requestBody = buildRequestBody(youtubeUrl, options.customPrompt ?? null);
      return fetch(`${API_BASE_URL}/${model}:generateContent?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
    })
    .then(async (response) => {
      await assertOkResponse(response);
      return response.json();
    })
    .then(async (data) => {
      const { markdown, inputTokens, outputTokens, totalTokens } = parseResponse(data);
      const estimatedCost = estimateCost({ inputTokens, outputTokens }, model);

      // 4. 응답을 받은 뒤 사용량/비용을 기록한다.
      await recordUsage(totalTokens, estimatedCost);

      return {
        markdown,
        model,
        usage: { inputTokens, outputTokens, totalTokens },
        estimatedCost,
      };
    })
    .catch((error) => {
      // fetch 자체가 실패한 경우(네트워크 오류 등)는 GeminiApiError로 감싸서 던진다.
      if (error instanceof GeminiApiError) throw error;
      throw new GeminiApiError(
        "Gemini API 호출 중 알 수 없는 오류가 발생했습니다.",
        ERROR_CODES.REQUEST_FAILED,
        error
      );
    });
}

export { analyzeYouTubeVideo, DEFAULT_MODEL, GeminiApiError, ERROR_CODES };
