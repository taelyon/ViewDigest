// LilysAI Style YouTube Analyzer - background service worker
//
// TODO: 확장프로그램 설치/업데이트 시 초기화 로직 구현 (chrome.runtime.onInstalled)
// TODO: content.js / popup.js 로부터의 메시지 라우팅 구현 (chrome.runtime.onMessage)
// TODO: Gemini API 호출을 background에서 중계할지 여부 결정 및 구현 (utils/gemini.js 연동)
// TODO: 분석 결과 캐싱 및 storage 동기화 로직 구현 (utils/storage.js 연동)
// TODO: 비용 추적 로직 연동 (utils/cost.js 연동)

chrome.runtime.onInstalled.addListener(() => {
  // TODO: 최초 설치 시 기본 옵션 값 저장
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // TODO: message.type 에 따라 분기 처리
  return false;
});
