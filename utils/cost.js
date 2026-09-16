// LilysAI Style YouTube Analyzer - 비용 추적/계산
//
// NOTE: 아래 단가는 정확한 공식 요금이 아닌 대략적인 추정치입니다.
// 실제 청구 금액과 다를 수 있으니 참고용으로만 사용하고, 필요 시 최신 공식 가격으로 갱신하세요.

import { getSettings } from "./storage.js";

const USAGE_LOG_KEY = "usageLog";
const MAX_USAGE_LOG_DAYS = 120;
const DEFAULT_DAILY_LIMIT = 20;

// 100만 토큰당 대략적인 입력/출력 가격 (USD)
const MODEL_PRICING = {
  "gemini-3.5-flash-lite": { input: 0.05, output: 0.2 },
  "gemini-3.7-flash": { input: 0.15, output: 0.6 },
  "gemini-3.8-flash": { input: 0.2, output: 0.8 },
};

const DEFAULT_PRICING = MODEL_PRICING["gemini-3.7-flash"];

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
 * usage: { inputTokens, outputTokens }
 */
function estimateCost(usage, model) {
  const pricing = MODEL_PRICING[model] ?? DEFAULT_PRICING;
  const inputTokens = usage?.inputTokens ?? 0;
  const outputTokens = usage?.outputTokens ?? 0;
  const cost =
    (inputTokens / 1_000_000) * pricing.input +
    (outputTokens / 1_000_000) * pricing.output;
  return cost;
}

/**
 * 오늘 하루 분석 횟수가 일일 한도(기본 20회, options에서 변경 가능)를 넘었는지 확인
 */
async function checkRateLimit() {
  const settings = await getSettings();
  const limit = settings.dailyLimit ?? DEFAULT_DAILY_LIMIT;
  const log = await getUsageLog();
  const todayKey = getDateKey();
  const used = log.filter((entry) => entry.date === todayKey).length;

  return {
    allowed: used < limit,
    used,
    limit,
    remaining: Math.max(limit - used, 0),
  };
}

/**
 * 토큰 사용량과 비용을 오늘 날짜로 기록
 */
async function recordUsage(tokens, cost) {
  const log = await getUsageLog();
  const entry = {
    date: getDateKey(),
    tokens: tokens ?? 0,
    cost: cost ?? 0,
    timestamp: Date.now(),
  };

  const cutoff = Date.now() - MAX_USAGE_LOG_DAYS * 24 * 60 * 60 * 1000;
  const pruned = log.filter((item) => item.timestamp >= cutoff);
  const updated = [...pruned, entry];

  await chrome.storage.local.set({ [USAGE_LOG_KEY]: updated });
  return entry;
}

function summarize(entries) {
  return entries.reduce(
    (acc, entry) => ({
      count: acc.count + 1,
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
  DEFAULT_DAILY_LIMIT,
  estimateCost,
  checkRateLimit,
  recordUsage,
  getUsageStats,
};
