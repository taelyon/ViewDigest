// ViewDigest - 비용 추적/계산
//
// NOTE: 아래 단가는 2026-09 기준 Gemini 유료 등급 공식 요금표
// (https://ai.google.dev/gemini-api/docs/pricing, 입력 20만 토큰 이하 구간)를 옮긴 것입니다.
// 요금은 바뀔 수 있고, Google 검색 그라운딩(월 5,000회 무료, 초과분은 1,000회당 $14)은
// 포함하지 않으므로 실제 청구 금액과 다를 수 있습니다. 요금이 바뀌면 이 표를 갱신하세요.

import { getSettings } from "./storage.js";
import { t } from "./i18n.js";

const USAGE_LOG_KEY = "usageLog";
const MAX_USAGE_LOG_DAYS = 120;
const DEFAULT_DAILY_LIMIT = 20;

// 100만 토큰당 입력/출력 가격 (USD). 출력에는 사고(thinking) 토큰도 포함해 청구된다.
// 3.7/3.8 Flash는 2026-12-31까지 도입가(intro)가 적용되고 2027-01-01부터 표준가로 오른다.
const FLASH_INTRO_PRICING = { input: 0.75, output: 3.75, until: "2027-01-01" };

const MODEL_PRICING = {
  "gemini-3.5-flash-lite": { input: 0.3, output: 2.5 },
  "gemini-3.7-flash": { input: 1.5, output: 7.5, intro: FLASH_INTRO_PRICING },
  "gemini-3.8-flash": { input: 1.5, output: 7.5, intro: FLASH_INTRO_PRICING },
};

const DEFAULT_PRICING = MODEL_PRICING["gemini-3.7-flash"];

/**
 * 분석 시점에 적용되는 모델 단가. 도입가 기간이면 도입가를, 아니면 표준가를 돌려준다.
 */
function getModelPricing(model, date = new Date()) {
  const pricing = MODEL_PRICING[model] ?? DEFAULT_PRICING;
  if (pricing.intro && date < new Date(pricing.intro.until)) {
    return pricing.intro;
  }
  return pricing;
}

function getDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getMonthKey(date = new Date()) {
  return getDateKey(date).slice(0, 7);
}

async function getUsageLog() {
  const { [USAGE_LOG_KEY]: log } = await chrome.storage.local.get(USAGE_LOG_KEY);
  return log ?? [];
}

/**
 * 모델별 단가를 기준으로 예상 비용(USD)을 계산
 * usage: { inputTokens, outputTokens } (outputTokens는 사고 토큰 포함)
 */
function estimateCost(usage, model, date = new Date()) {
  const pricing = getModelPricing(model, date);
  const inputTokens = usage?.inputTokens ?? 0;
  const outputTokens = usage?.outputTokens ?? 0;
  const cost =
    (inputTokens / 1_000_000) * pricing.input +
    (outputTokens / 1_000_000) * pricing.output;
  return cost;
}

// 사용 기록의 종류. "analysis"(영상을 보는 요청: 분석, 영상 전체에서 찾는 질문)만 일일 분석
// 횟수에 센다. 리포트만 보고 답하는 질문("question")은 비용만 더한다. 예전 기록은 kind가 없으며 분석이다.
const USAGE_KIND = { ANALYSIS: "analysis", QUESTION: "question" };

function isAnalysis(entry) {
  return (entry.kind ?? USAGE_KIND.ANALYSIS) === USAGE_KIND.ANALYSIS;
}

/** 설정의 월 예산(USD). 없거나 0 이하이면 null(제한 없음). */
function monthlyBudgetOf(settings) {
  const budget = Number(settings.monthlyBudget);
  return Number.isFinite(budget) && budget > 0 ? budget : null;
}

/**
 * 오늘 하루 분석 횟수가 일일 한도(기본 20회, options에서 변경 가능)를 넘었는지, 이번 달 예상 비용이
 * 월 예산을 넘었는지 확인한다. allowed는 둘 다 괜찮을 때만 true다.
 */
async function checkRateLimit() {
  const settings = await getSettings();
  const limit = settings.dailyLimit ?? DEFAULT_DAILY_LIMIT;
  const log = await getUsageLog();
  const todayKey = getDateKey();
  const monthKey = getMonthKey();
  const used = log.filter((entry) => entry.date === todayKey && isAnalysis(entry)).length;
  const monthCost = log
    .filter((entry) => entry.date.startsWith(monthKey))
    .reduce((sum, entry) => sum + (entry.cost ?? 0), 0);
  const budget = monthlyBudgetOf(settings);
  const budgetExceeded = budget !== null && monthCost >= budget;

  return {
    allowed: used < limit && !budgetExceeded,
    dailyLimitReached: used >= limit,
    used,
    limit,
    remaining: Math.max(limit - used, 0),
    budget,
    monthCost,
    budgetExceeded,
  };
}

/** 사람이 읽기 좋은 달러 금액. 작은 금액은 자릿수를 더 보여 준다. */
function formatUsd(usd) {
  if (typeof usd !== "number" || Number.isNaN(usd)) return "$0";
  if (usd >= 10) return `$${usd.toFixed(0)}`;
  if (usd >= 0.1) return `$${usd.toFixed(2)}`;
  return `$${usd.toFixed(3)}`;
}

/**
 * checkRateLimit()가 막았을 때 사용자에게 보여 줄 오류. 월 예산 초과를 일일 한도보다 먼저 알린다
 * (예산은 날이 바뀌어도 풀리지 않으므로).
 */
function limitError(rateLimit) {
  if (rateLimit.budgetExceeded) {
    return { code: "BUDGET_EXCEEDED", message: t("budgetExceeded", formatUsd(rateLimit.budget)) };
  }
  return { code: "RATE_LIMITED", message: t("rateLimited", rateLimit.limit) };
}

/**
 * 토큰 사용량과 비용을 오늘 날짜로 기록
 */
async function recordUsage(tokens, cost, kind = USAGE_KIND.ANALYSIS) {
  const log = await getUsageLog();
  const entry = {
    date: getDateKey(),
    tokens: tokens ?? 0,
    cost: cost ?? 0,
    kind,
    timestamp: Date.now(),
  };

  const cutoff = Date.now() - MAX_USAGE_LOG_DAYS * 24 * 60 * 60 * 1000;
  const pruned = log.filter((item) => item.timestamp >= cutoff);
  const updated = [...pruned, entry];

  await chrome.storage.local.set({ [USAGE_LOG_KEY]: updated });
  return entry;
}

// 분석 전 예상 비용. 실제 청구액은 영상 내용(말의 양, 검색 횟수, 추론 길이)에 따라 달라지므로
// 대략적인 값이다. 낮은 해상도(media_resolution_low)에서 영상 1초는 화면 약 70토큰 + 소리 약
// 32토큰이고, 출력은 추론(상한 8,192)과 리포트 길이를 더한 값으로 잡는다.
const VIDEO_TOKENS_PER_SECOND = 100;
const PROMPT_TOKENS = 1500;
const THINKING_TOKENS = 5000;
const REPORT_OUTPUT_TOKENS = {
  brief: () => 400,
  standard: (minutes) => Math.min(1500 + minutes * 150, 9000),
  detailed: (minutes) => Math.min(2500 + minutes * 260, 16000),
};

/**
 * @param {number} durationSeconds 영상 길이(초)
 * @param {string} [model]
 * @param {string} [reportLength] "brief" / "standard" / "detailed"
 * @returns {{inputTokens: number, outputTokens: number, cost: number} | null} 길이를 모르면 null
 */
function estimateAnalysisCost(durationSeconds, model, reportLength = "standard") {
  const seconds = Number(durationSeconds);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const minutes = seconds / 60;
  const report = REPORT_OUTPUT_TOKENS[reportLength] ?? REPORT_OUTPUT_TOKENS.standard;
  const inputTokens = Math.round(PROMPT_TOKENS + seconds * VIDEO_TOKENS_PER_SECOND);
  const outputTokens = Math.round(THINKING_TOKENS + report(minutes));
  return { inputTokens, outputTokens, cost: estimateCost({ inputTokens, outputTokens }, model) };
}

function summarize(entries) {
  return entries.reduce(
    (acc, entry) => ({
      count: acc.count + (isAnalysis(entry) ? 1 : 0),
      tokens: acc.tokens + (entry.tokens ?? 0),
      cost: acc.cost + (entry.cost ?? 0),
    }),
    { count: 0, tokens: 0, cost: 0 }
  );
}

/**
 * 오늘/이번 달 사용량과 예상 비용을 반환
 */
async function getUsageStats() {
  const log = await getUsageLog();
  const todayKey = getDateKey();
  const monthKey = getMonthKey();

  const today = summarize(log.filter((entry) => entry.date === todayKey));
  const month = summarize(log.filter((entry) => entry.date.startsWith(monthKey)));

  return { today, month };
}

export {
  MODEL_PRICING,
  getDateKey,
  DEFAULT_DAILY_LIMIT,
  USAGE_KIND,
  estimateCost,
  estimateAnalysisCost,
  formatUsd,
  checkRateLimit,
  limitError,
  recordUsage,
  getUsageStats,
};
