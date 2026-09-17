// ViewDigest - Gemini API 클라이언트
//
// Lilys AI와 동일한 원리로 동작한다: YouTube 자막(수동 업로드 또는 자동 생성)을
// 먼저 추출해 텍스트만 Gemini에 넘기고, 자막이 없는 영상만 예외적으로 영상
// 자체(fileData)를 Gemini에 보내 자체 인식(오디오/화면)에 맡긴다. 텍스트
// 기반 분석은 영상 길이와 무관하게 토큰 비용이 훨씬 저렴하고 안정적이다.

import { getSystemInstruction, getUserPrompt } from "./prompt.js";
import { checkRateLimit, estimateCost, recordUsage } from "./cost.js";
import { getTranscript } from "./transcript.js";

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

// SYSTEM_INSTRUCTION이 요구하는 초고밀도 리포트 + googleSearch 도구 사용은 모델이
// 답변을 쓰기 전에 내부적으로 여러 차례 검색/추론(thinking)을 반복하게 만든다.
// thinkingBudget을 지정하지 않으면(동적/무제한) 이 추론 과정이 출력 토큰 예산을
// 전부 소진해버려, 실제 리포트 텍스트는 한 글자도 못 쓴 채 finishReason이
// MAX_TOKENS로 끝나는 "빈 응답"이 발생할 수 있다. thinkingBudget을 정해두면
// 나머지 예산은 항상 실제 답변 텍스트를 위해 남는다.
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
 * 자막(Transcript)이 확보된 경우의 요청 바디. 영상 자체는 전혀 첨부하지
 * 않고, 자막 전문(타임스탬프 포함 텍스트)만 프롬프트에 이어붙여 전달한다.
 * 토큰 비용이 영상 길이와 무관하게 자막 분량에만 비례하므로, 1시간짜리
 * 영상도 저렴하고 안정적으로 처리할 수 있다 — Lilys AI의 핵심 동작 방식과
 * 동일하다.
 */
function buildTranscriptRequestBody(youtubeUrl, transcriptText, customPrompt) {
  return {
    systemInstruction: {
      parts: [{ text: getSystemInstruction() }],
    },
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `${getUserPrompt(customPrompt)}

[분석 대상]
영상 URL: ${youtubeUrl}
아래는 이 영상의 자막 전문(타임스탬프 포함)이다. 화면에 무엇이 나오는지는 알 수 없으니, 이 자막 텍스트의 발언·수치·맥락을 근거로 위 요건에 맞는 리포트를 작성하라. 자막에 화자 구분이 없다면 문맥으로 판단하라.

[자막 전문]
${transcriptText}`,
          },
        ],
      },
    ],
    tools: [{ googleSearch: {} }],
    generationConfig: GENERATION_CONFIG,
  };
}

/**
 * 자막을 구할 수 없는 영상(자막 미제공 등)에 대한 폴백 요청 바디.
 * fileData.fileUri 로 YouTube URL을 그대로 전달해, Gemini 자체의
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
function buildVideoFallbackRequestBody(youtubeUrl, customPrompt) {
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
 * 응답 텍스트가 비어있을 때, finishReason을 근거로 실제 원인을 구체적으로 안내한다.
 * (원인을 모르면 사용자는 그냥 "빈 응답"만 보고 재시도 외에 할 수 있는 게 없다.)
 */
function describeEmptyResponse(finishReason) {
  switch (finishReason) {
    case "MAX_TOKENS":
      return "Gemini가 답변을 작성하기 전에 내부 추론/검색 과정에서 최대 출력 토큰 한도에 도달해 응답이 끊겼습니다. 영상이 매우 길거나 다루는 정보가 방대할 수 있습니다. 잠시 후 다시 시도해주세요.";
    case "SAFETY":
    case "PROHIBITED_CONTENT":
    case "BLOCKLIST":
    case "SPII":
      return "Gemini의 안전 정책에 의해 이 영상에 대한 응답이 차단되었습니다.";
    case "RECITATION":
      return "Gemini가 원본 콘텐츠와의 유사도 문제로 응답 생성을 중단했습니다.";
    default:
      return "Gemini가 빈 응답을 반환했습니다.";
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
 * URL 검증 → 일일 한도 확인 → API 키 확인 → 자막 조회(또는 폴백) → 요청 바디 구성.
 * 이 단계에서 던지는 에러는 항상 GeminiApiError이다.
 */
async function prepareRequest(youtubeUrl, options, onStatus) {
  if (!isLikelyYoutubeUrl(youtubeUrl)) {
    throw new GeminiApiError(
      "올바른 YouTube 영상 URL이 아닙니다.",
      ERROR_CODES.INVALID_URL,
      { youtubeUrl }
    );
  }

  // 1. 호출 전 일일 사용량 제한을 먼저 확인해 불필요한 API 호출을 막는다.
  const rateLimit = await checkRateLimit();
  if (!rateLimit.allowed) {
    throw new GeminiApiError(
      `오늘의 분석 가능 횟수(${rateLimit.limit}회)를 모두 사용했습니다.`,
      ERROR_CODES.RATE_LIMITED,
      rateLimit
    );
  }

  // 2. API 키가 없으면 요청을 보내기 전에 명확한 에러로 안내한다.
  const apiKey = await getApiKey();
  if (!apiKey) {
    throw new GeminiApiError(
      "Gemini API 키가 설정되지 않았습니다. 옵션 페이지에서 먼저 등록해주세요.",
      ERROR_CODES.MISSING_API_KEY
    );
  }

  // 3. 자막을 우선 시도하고, 없으면(또는 조회 자체가 실패하면) 영상 자체를
  //    Gemini에 보내는 방식으로 폴백한다.
  onStatus?.("영상 자막을 확인하고 있습니다...");
  const transcript = await getTranscript(youtubeUrl).catch(() => null);
  const requestBody = transcript
    ? buildTranscriptRequestBody(youtubeUrl, transcript.text, options.customPrompt ?? null)
    : buildVideoFallbackRequestBody(youtubeUrl, options.customPrompt ?? null);

  return { apiKey, requestBody };
}

function toGeminiApiError(error) {
  if (error instanceof GeminiApiError) return error;
  return new GeminiApiError(
    "Gemini API 호출 중 알 수 없는 오류가 발생했습니다.",
    ERROR_CODES.REQUEST_FAILED,
    error
  );
}

/**
 * YouTube 영상을 분석한다. 자막이 있으면 자막 텍스트 기반으로, 없으면
 * Gemini의 영상 이해(fileData)로 폴백해 분석한다.
 *
 * @param {string} youtubeUrl 분석할 YouTube 영상 URL
 * @param {object} [options]
 * @param {string} [options.model] 사용할 모델명 (기본값: DEFAULT_MODEL)
 * @param {string} [options.customPrompt] 기본 프롬프트 대신 사용할 커스텀 프롬프트
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
async function* iterateSseChunks(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      const rawEvent = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);

      const dataLine = rawEvent.split("\n").find((line) => line.startsWith("data:"));
      if (!dataLine) continue;
      const jsonStr = dataLine.slice(5).trim();
      if (!jsonStr) continue;

      try {
        yield JSON.parse(jsonStr);
      } catch {
        // 네트워크 경계에 걸려 조각난 JSON은 건너뛴다(다음 read에서 이어붙지 않고
        // 손실되지만, 표시용 델타 텍스트 한 조각 누락은 최종 결과에 영향 없음 —
        // 최종 markdown은 서버가 마지막에 보내는 누적 usageMetadata와 무관하게
        // 지금까지 받은 델타들의 합이므로, 이 케이스는 사실상 발생하지 않는다).
      }
    }
  }
}

/**
 * analyzeYouTubeVideo의 스트리밍 버전. Gemini가 텍스트를 생성하는 대로
 * 점진적으로 이벤트를 yield해, 호출부(예: results.js)가 전체 응답을 기다리지
 * 않고 실시간으로 화면에 표시할 수 있게 한다.
 *
 * 이벤트 형태:
 * - { type: "status", message }: 진행 상태 안내(자막 조회 중, 생성 중 등)
 * - { type: "delta", text, markdown }: 새로 생성된 텍스트 조각과, 지금까지의 누적 markdown
 * - { type: "done", result }: analyzeYouTubeVideo와 동일한 형태의 최종 결과
 *
 * 준비 단계(URL/한도/키 확인 등) 또는 스트림 자체에서 에러가 나면 GeminiApiError를 던진다.
 */
async function* analyzeYouTubeVideoStream(youtubeUrl, options = {}) {
  const model = options.model ?? DEFAULT_MODEL;

  try {
    const statusEvents = [];
    const { apiKey, requestBody } = await prepareRequest(youtubeUrl, options, (message) =>
      statusEvents.push(message)
    );
    for (const message of statusEvents) yield { type: "status", message };

    yield { type: "status", message: "Gemini가 분석을 생성하고 있습니다..." };

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
    for await (const chunk of iterateSseChunks(response)) {
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
      throw new GeminiApiError(describeEmptyResponse(finishReason), ERROR_CODES.EMPTY_RESPONSE, {
        finishReason,
      });
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
