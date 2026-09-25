// ViewDigest - 웹스토어 리뷰 요청과 공유용 출처 표기
//
// 리뷰 요청은 설치 직후가 아니라, 분석이 몇 번 성공해 확장프로그램이 실제로 쓸모 있었던
// 뒤에 한다. 사용자가 거절하면 존중한다: "나중에"는 한참 뒤에 한 번 더, "다시 보지 않기"와
// "리뷰 남기기"는 다시 묻지 않는다.

import { getHistory } from "./storage.js";

const STORAGE_KEY = "reviewPrompt";
const FIRST_ASK_AFTER = 3; // 성공한 분석 수
const ASK_AGAIN_AFTER = 10; // "나중에"를 누른 뒤 추가로 성공해야 하는 분석 수

/**
 * 스토어에서 설치한 확장프로그램은 확장프로그램 ID가 곧 웹스토어 항목 ID다.
 * (개발자 모드로 불러온 사본은 ID가 달라 이 주소가 맞지 않는다.)
 */
function storePageUrl() {
  return `https://chromewebstore.google.com/detail/${chrome.runtime.id}`;
}

function storeReviewUrl() {
  return `${storePageUrl()}/reviews`;
}

async function getState() {
  const { [STORAGE_KEY]: state } = await chrome.storage.local.get(STORAGE_KEY);
  if (state) return state;
  // 이 기능이 생기기 전부터 쓰던 사용자는 이미 한 분석부터 센다.
  return { successCount: (await getHistory()).length, nextAskAt: FIRST_ASK_AFTER, done: false };
}

async function setState(state) {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}

/** 분석이 하나 성공할 때마다(직접·자동 모두) 부른다. */
async function recordSuccessfulAnalysis() {
  const { [STORAGE_KEY]: stored } = await chrome.storage.local.get(STORAGE_KEY);
  if (!stored) {
    // 처음 세는 경우: 방금 저장한 분석이 이미 히스토리에 들어 있으므로 더하지 않는다.
    await setState(await getState());
    return;
  }
  await setState({ ...stored, successCount: stored.successCount + 1 });
}

/** @returns {Promise<number | null>} 지금 리뷰를 부탁할 때면 성공한 분석 수, 아니면 null */
async function reviewPromptCount() {
  const state = await getState();
  if (state.done || state.successCount < state.nextAskAt) return null;
  return state.successCount;
}

/** @param {"review" | "later" | "never"} answer */
async function answerReviewPrompt(answer) {
  const state = await getState();
  if (answer === "later") {
    await setState({ ...state, nextAskAt: state.successCount + ASK_AGAIN_AFTER });
  } else {
    await setState({ ...state, done: true });
  }
}

export {
  FIRST_ASK_AFTER,
  ASK_AGAIN_AFTER,
  storePageUrl,
  storeReviewUrl,
  recordSuccessfulAnalysis,
  reviewPromptCount,
  answerReviewPrompt,
};
