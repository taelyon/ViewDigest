// ViewDigest - Gemini API 클라이언트
//
// 영상 URL(fileData)을 그대로 Gemini에 넘겨, Gemini 자체의 오디오/화면 인식으로
// 분석한다.
//
// 한때는 YouTube 자막을 먼저 추출해 텍스트만 넘기고(더 싸고 빠르다) 자막이 없는
// 영상만 이 방식으로 폴백했지만, 그 경로는 제거했다. YouTube의 자막 엔드포인트
// (timedtext)가 플레이어가 생성하는 증명 토큰(pot) 없이는 본문 대신 빈 200을
// 돌려주기 때문이다. 포맷(json3/xml), 쿠키 유무, 요청 출처, 영상 페이지를 보고
// 있는 탭 안에서 동일 세션으로 호출하는 것까지 모두 시도했으나 결과는 동일했고,
// 확장 프로그램이 그 토큰을 만들어낼 방법은 없다.

import { getSystemInstruction, getUserPrompt, resolveReportLanguage } from "./prompt.js";
import { checkRateLimit, estimateCost, recordUsage } from "./cost.js";
import { t } from "./i18n.js";

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

// 영상 자체를 인식해야 하므로 추론과 검색 그라운딩이 실제로 필요하다. 다만
// 예산을 열어두면(동적/무제한) 그 추론이 출력 토큰을 전부 소진해 리포트를 한
// 글자도 못 쓴 채 finishReason MAX_TOKENS로 끝나므로 상한을 둔다.
const GENERATION_CONFIG = {
  thinkingConfig: { thinkingBudget: 8192 },
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
            t("geminiKeyLoadError"),
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
 * 분석 요청 바디. fileData.fileUri 로 YouTube URL을 그대로 전달해, Gemini 자체의
 * 오디오/화면 인식(자체 STT에 해당)에 맡긴다.
 * - `mediaProcessing: "AGENTIC"` 은 의도적으로 사용하지 않는다. SYSTEM_INSTRUCTION이
 *   "영상의 모든 순간을 빠짐없이" 다루도록 요구하는 초고밀도 프롬프트인데,
 *   Google 문서에 따르면 그런 질의는 agentic 모드의 이점이 없고 결국 전체를
 *   다 훑게 되며, agentic의 서버사이드 다중 턴 탐색 루프가 매 턴 누적
 *   컨텍스트를 반복 전송해 토큰이 기하급수적으로 불어난다(7분 영상에서도
 *   1,048,576 토큰 한도 초과가 실제로 발생했다). 안정적인 정적(1fps) 처리를
 *   사용한다.
 * - `mediaResolution: { level: "media_resolution_low" }` 로 프레임당 토큰
 *   사용량을 낮춘다.
 */
function buildRequestBody(youtubeUrl, customPrompt, language) {
  return {
    systemInstruction: {
      parts: [{ text: getSystemInstruction(language) }],
    },
    contents: [
      {
        role: "user",
        parts: [
          { text: getUserPrompt(customPrompt, language) },
          {
            fileData: { fileUri: youtubeUrl, mimeType: "video/mp4" },
            mediaResolution: { level: "media_resolution_low" },
          },
        ],
      },
    ],
    tools: [{ googleSearch: {} }],
    generationConfig: GENERATION_CONFIG,
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
      t("geminiVideoTooLong"),
      ERROR_CODES.REQUEST_FAILED,
      { status: response.status, body: details }
    );
  }

  const message = apiMessage
    ? t("geminiRequestFailed", apiMessage)
    : t("geminiRequestFailedStatus", response.status);

  throw new GeminiApiError(message, ERROR_CODES.REQUEST_FAILED, {
    status: response.status,
    body: details,
  });
}

/**
 * 응답 텍스트가 비어있을 때, finishReason을 근거로 실제 원인을 구체적으로 안내한다.
 * (원인을 모르면 사용자는 그냥 "빈 응답"만 보고 재시도 외에 할 수 있는 게 없다.)
 */
function describeEmptyResponse(finishReason) {
  switch (finishReason) {
    case "MAX_TOKENS":
      return t("geminiMaxTokens");
    case "SAFETY":
    case "PROHIBITED_CONTENT":
    case "BLOCKLIST":
    case "SPII":
      return t("geminiSafety");
    case "RECITATION":
      return t("geminiRecitation");
    default:
      return t("geminiEmpty");
  }
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
      describeEmptyResponse(candidate?.finishReason),
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
 * analyzeYouTubeVideo와 analyzeYouTubeVideoStream이 공유하는 준비 단계:
 * URL 검증 → 일일 한도 확인 → API 키 확인 → 요청 바디 구성.
 * 이 단계에서 던지는 에러는 항상 GeminiApiError이다.
 */
async function prepareRequest(youtubeUrl, options) {
  if (!isLikelyYoutubeUrl(youtubeUrl)) {
    throw new GeminiApiError(
      t("geminiInvalidUrl"),
      ERROR_CODES.INVALID_URL,
      { youtubeUrl }
    );
  }

  // 1. 호출 전 일일 사용량 제한을 먼저 확인해 불필요한 API 호출을 막는다.
  const rateLimit = await checkRateLimit();
  if (!rateLimit.allowed) {
    throw new GeminiApiError(
      t("rateLimited", rateLimit.limit),
      ERROR_CODES.RATE_LIMITED,
      rateLimit
    );
  }

  // 2. API 키가 없으면 요청을 보내기 전에 명확한 에러로 안내한다.
  const apiKey = await getApiKey();
  if (!apiKey) {
    throw new GeminiApiError(
      t("geminiMissingKey"),
      ERROR_CODES.MISSING_API_KEY
    );
  }

  const language = resolveReportLanguage(options.reportLanguage, chrome.i18n.getUILanguage());
  return {
    apiKey,
    requestBody: buildRequestBody(youtubeUrl, options.customPrompt ?? null, language),
  };
}

function toGeminiApiError(error) {
  if (error instanceof GeminiApiError) return error;
  return new GeminiApiError(
    t("geminiUnknownError"),
    ERROR_CODES.REQUEST_FAILED,
    error
  );
}

/**
 * YouTube 영상을 Gemini의 영상 이해(fileData)로 분석한다.
 *
 * @param {string} youtubeUrl 분석할 YouTube 영상 URL
 * @param {object} [options]
 * @param {string} [options.model] 사용할 모델명 (기본값: DEFAULT_MODEL)
 * @param {string} [options.customPrompt] 기본 프롬프트 대신 사용할 커스텀 프롬프트
 * @param {string} [options.reportLanguage] 리포트 언어 설정("auto" / "ko" / "en", 기본 "auto")
 * @returns {Promise<{markdown: string, model: string, usage: {inputTokens: number, outputTokens: number, totalTokens: number}, estimatedCost: number}>}
 */
async function analyzeYouTubeVideo(youtubeUrl, options = {}) {
  const model = options.model ?? DEFAULT_MODEL;

  try {
    const { apiKey, requestBody } = await prepareRequest(youtubeUrl, options);

    const response = await fetch(`${API_BASE_URL}/${model}:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });
    await assertOkResponse(response);
    const data = await response.json();

    const { markdown, inputTokens, outputTokens, totalTokens } = parseResponse(data);
    const estimatedCost = estimateCost({ inputTokens, outputTokens }, model);

    // 응답을 받은 뒤 사용량/비용을 기록한다.
    await recordUsage(totalTokens, estimatedCost);

    return {
      markdown,
      model,
      usage: { inputTokens, outputTokens, totalTokens },
      estimatedCost,
    };
  } catch (error) {
    // fetch 자체가 실패한 경우(네트워크 오류 등)는 GeminiApiError로 감싸서 던진다.
    throw toGeminiApiError(error);
  }
}

/**
 * SSE(Server-Sent Events) 스트림 응답 본문을 JSON 청크 단위로 순회한다.
 * Gemini의 `:streamGenerateContent?alt=sse` 응답은 `data: {...}\n\n` 블록이
 * 반복되는 형태이며, 각 청크의 candidates[].content.parts[].text는 지금까지
 * 누적된 텍스트가 아니라 그 청크에서 새로 생성된 텍스트(델타)다.
 */
function parseSseEvent(rawEvent) {
  // SSE 명세상 한 이벤트가 여러 개의 data: 줄로 쪼개져 올 수 있으므로 전부 이어붙인다.
  const payload = rawEvent
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("");

  if (!payload || payload === "[DONE]") return null;

  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

async function* iterateSseChunks(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    // 캐리지 리턴을 먼저 제거한다. 서버가 CRLF로 구분자를 보내면 "\n\n" 경계를
    // 영원히 못 찾아 이벤트가 단 하나도 파싱되지 않고, 스트림이 조용히 끝나
    // 원인을 알 수 없는 "빈 응답"이 된다. (JSON 문자열 안의 개행은 \r이 아니라
    // 이스케이프된 두 글자라서 이 치환에 영향받지 않는다.)
    buffer += decoder.decode(value, { stream: true }).replace(/\r/g, "");

    let boundary;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      const rawEvent = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);

      const chunk = parseSseEvent(rawEvent);
      if (chunk) yield chunk;
    }
  }

  // 마지막 이벤트 뒤에 빈 줄이 없이 스트림이 끝나면 위 루프가 그 이벤트를
  // 버퍼에 남긴 채 끝나므로, 남은 버퍼도 마저 처리한다.
  const tail = parseSseEvent(buffer);
  if (tail) yield tail;
}

/**
 * analyzeYouTubeVideo의 스트리밍 버전. Gemini가 텍스트를 생성하는 대로
 * 점진적으로 이벤트를 yield해, 호출부(예: results.js)가 전체 응답을 기다리지
 * 않고 실시간으로 화면에 표시할 수 있게 한다.
 *
 * 이벤트 형태:
 * - { type: "status", message }: 진행 상태 안내(분석 생성 중 등)
 * - { type: "delta", text, markdown }: 새로 생성된 텍스트 조각과, 지금까지의 누적 markdown
 * - { type: "done", result }: analyzeYouTubeVideo와 동일한 형태의 최종 결과
 *
 * 준비 단계(URL/한도/키 확인 등) 또는 스트림 자체에서 에러가 나면 GeminiApiError를 던진다.
 */
async function* analyzeYouTubeVideoStream(youtubeUrl, options = {}) {
  const model = options.model ?? DEFAULT_MODEL;

  try {
    const { apiKey, requestBody } = await prepareRequest(youtubeUrl, options);

    // 영상 전체를 인식한 뒤에야 첫 글자가 나오므로, 여기서 한참 머무르는 것이
    // 정상이라는 점을 문구에 담는다.
    yield {
      type: "status",
      message: t("geminiAnalyzing"),
    };

    const response = await fetch(
      `${API_BASE_URL}/${model}:streamGenerateContent?alt=sse&key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      }
    );
    await assertOkResponse(response);

    let markdown = "";
    let usage = null;
    let finishReason = null;
    let receivedChunks = 0;
    for await (const chunk of iterateSseChunks(response)) {
      receivedChunks++;

      // SSE 스트림은 200 OK로 시작한 뒤 본문 안에서 실패를 알릴 수 있다.
      // assertOkResponse는 최초 상태 코드만 보므로, 여기서 걸러내지 않으면
      // 이 오류 청크는 candidates가 없다는 이유로 조용히 버려지고 텍스트가
      // 한 조각도 없는 채 스트림이 끝나 "빈 응답"으로 둔갑한다.
      if (chunk?.error) {
        throw new GeminiApiError(
          t("geminiRequestFailed", chunk.error.message ?? t("unknownErrorShort")),
          ERROR_CODES.REQUEST_FAILED,
          chunk.error
        );
      }

      // 요청 자체가 차단된 경우에도 candidates 없이 promptFeedback만 온다.
      const blockReason = chunk?.promptFeedback?.blockReason;
      if (blockReason) {
        throw new GeminiApiError(
          t("geminiBlocked", blockReason),
          ERROR_CODES.EMPTY_RESPONSE,
          chunk.promptFeedback
        );
      }

      const candidate = chunk?.candidates?.[0];
      const parts = candidate?.content?.parts ?? [];
      const deltaText = parts.map((part) => part.text ?? "").join("");
      if (deltaText) {
        markdown += deltaText;
        yield { type: "delta", text: deltaText, markdown };
      }
      if (candidate?.finishReason) finishReason = candidate.finishReason;
      if (chunk?.usageMetadata) usage = chunk.usageMetadata;
    }

    const trimmed = markdown.trim();
    if (!trimmed) {
      // 청크가 하나도 안 온 것과, 청크는 왔는데 텍스트가 없는 것은 원인이 전혀
      // 다르므로(전자는 연결/파싱 문제, 후자는 모델 쪽 중단) 구분해서 알린다.
      throw new GeminiApiError(
        receivedChunks === 0
          ? t("geminiNoData")
          : describeEmptyResponse(finishReason),
        ERROR_CODES.EMPTY_RESPONSE,
        { finishReason, receivedChunks, usage }
      );
    }

    const inputTokens = usage?.promptTokenCount ?? Math.ceil(trimmed.length / 4);
    const outputTokens = usage?.candidatesTokenCount ?? Math.ceil(trimmed.length / 4);
    const totalTokens = usage?.totalTokenCount ?? inputTokens + outputTokens;
    const estimatedCost = estimateCost({ inputTokens, outputTokens }, model);

    await recordUsage(totalTokens, estimatedCost);

    yield {
      type: "done",
      result: {
        markdown: trimmed,
        model,
        usage: { inputTokens, outputTokens, totalTokens },
        estimatedCost,
      },
    };
  } catch (error) {
    throw toGeminiApiError(error);
  }
}

export {
  analyzeYouTubeVideo,
  analyzeYouTubeVideoStream,
  DEFAULT_MODEL,
  GeminiApiError,
  ERROR_CODES,
};
