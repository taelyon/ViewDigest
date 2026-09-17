// ViewDigest - YouTube 페이지 content script
//
// 이 스크립트는 일반 script(non-module)로 주입되므로 utils/*.js 의 ES export를
// 직접 import할 수 없다. Gemini 호출 등 무거운 로직은 background.js 에서
// utils/gemini.js 를 통해 처리하고, 여기서는 메시지만 주고받는다.
//
// 역할:
//   1. YouTube 영상 시청 페이지에 "⚡ 영상 분석" 버튼을 두 군데 삽입
//      - 제목과 채널정보/액션 버튼 줄 사이(독립된 한 줄)
//      - 우측 추천 영상 영역(#secondary) 최상단(그 영역 박스들과 같은 폭)
//   2. 버튼 클릭 시 background.js 로 { action: "openResultsTab", url } 전송해
//      새 탭(results/results.html)을 열게 한다. 실제 분석/스트리밍 렌더링은
//      그 탭이 직접 수행하므로, 여기서는 탭을 여는 것까지만 책임진다.

(function () {
  const TITLE_BUTTON_ID = "viewdigest-analyze-button";
  const SIDEBAR_BUTTON_ID = "viewdigest-analyze-button-sidebar";
  const STYLE_ID = "viewdigest-analyze-button-style";
  const BUTTON_LABEL = "⚡ 영상 분석";
  const BUTTON_LABEL_FULL = "영상 분석 (초고밀도 분석 노트 생성)";

  // 좋아요/공유/다운로드 등 모든 네이티브 액션 버튼은 #actions-inner 안에서
  // 실질적으로 #menu 라는 단일 블록(ytd-menu-renderer)에 다 뭉쳐 들어있고,
  // #actions-inner는 사실상 그 #menu와 폭을 나눠 써야 하는 좁은 flex row다.
  // 그 줄 안에 우리 버튼을 함께 넣으면(앞이든 뒤든) 화면이 좁아질 때
  // 무언가가 다음 줄로 밀려나는 문제가 재발할 수 있다. 아예 그 줄과 폭을
  // 다투지 않도록, 제목 줄과 채널정보/액션 버튼 줄(#top-row) "사이"에
  // 우리 버튼만의 독립된 한 줄로 끼워넣는다.
  // YouTube DOM 구조는 자주 바뀌므로, 우선순위대로 여러 삽입 지점을 시도한다.
  // 여기서 찾는 건 "채널정보 + 액션 버튼 줄" 자체(#top-row) — 그 바로 앞에
  // 우리 버튼을 꽂아 제목과 그 줄 사이에 위치시킨다.
  const TITLE_ANCHOR_SELECTORS = [
    "ytd-watch-metadata #top-row",
    "#above-the-fold #top-row",
  ];

  // 우측 추천 영상 영역의 컨테이너 후보. 이 컨테이너의 맨 앞에 버튼을 넣고,
  // 폭은 100%로 채워 그 안의 추천 영상 박스들과 같은 폭이 되게 한다.
  const SIDEBAR_CONTAINER_SELECTORS = [
    "#secondary #related #items",
    "#secondary #related",
    "ytd-watch-flexy #secondary ytd-watch-next-secondary-results-renderer",
    "#secondary",
  ];

  let insertionScheduled = false;

  // ---------------------------------------------------------------------
  // 유틸리티
  // ---------------------------------------------------------------------

  function isWatchPage() {
    return (
      location.pathname === "/watch" &&
      new URLSearchParams(location.search).has("v")
    );
  }

  function findFirstMatch(selectors) {
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el) return el;
    }
    return null;
  }

  // ---------------------------------------------------------------------
  // 분석 버튼: 삽입 / 제거 / 클릭 처리
  // ---------------------------------------------------------------------

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${TITLE_BUTTON_ID}, #${SIDEBAR_BUTTON_ID} {
        display: inline-flex !important;
        align-items: center;
        justify-content: center;
        gap: 6px;
        overflow: hidden;
        height: 36px;
        padding: 0 16px;
        border: none;
        border-radius: 18px;
        background: linear-gradient(135deg, #5B21B6, #7C3AED);
        color: #ffffff;
        font-size: 14px;
        font-weight: 600;
        font-family: "Roboto", "Noto Sans KR", Arial, sans-serif;
        cursor: pointer;
        box-shadow: 0 2px 6px rgba(91, 33, 182, 0.4);
        transition: filter 0.15s ease, transform 0.15s ease;
        white-space: nowrap;
        text-overflow: ellipsis;
      }
      #${TITLE_BUTTON_ID} {
        flex: 0 1 auto !important;
        width: auto !important;
        max-width: 160px !important;
        min-width: 32px;
        margin: 8px 0;
      }
      #${SIDEBAR_BUTTON_ID} {
        width: 100% !important;
        max-width: 100% !important;
        box-sizing: border-box !important;
        margin: 0 0 12px 0;
      }
      #${TITLE_BUTTON_ID}:hover:not(:disabled), #${SIDEBAR_BUTTON_ID}:hover:not(:disabled) {
        filter: brightness(1.08);
        transform: translateY(-1px);
      }
      #${TITLE_BUTTON_ID}:active:not(:disabled), #${SIDEBAR_BUTTON_ID}:active:not(:disabled) {
        transform: translateY(0);
      }
      #${TITLE_BUTTON_ID}:disabled, #${SIDEBAR_BUTTON_ID}:disabled {
        opacity: 0.7;
        cursor: default;
      }
    `;
    document.head.appendChild(style);
  }

  function handleAnalyzeClick(event) {
    const button = event.currentTarget;
    if (button.disabled) return;

    // 실제 분석/진행 상태 표시는 새로 열리는 results 탭이 전담하므로, 이 버튼은
    // 탭을 여는 짧은 순간만 중복 클릭을 막고 바로 원래 상태로 돌아온다.
    button.disabled = true;

    chrome.runtime.sendMessage(
      { action: "openResultsTab", url: location.href },
      (response) => {
        void chrome.runtime.lastError;
        if (!response?.success) {
          button.textContent = "❌ 열기 실패";
          button.title = response?.error?.message ?? "새 탭을 여는 중 오류가 발생했습니다.";
          setTimeout(() => {
            button.textContent = BUTTON_LABEL;
            button.title = BUTTON_LABEL_FULL;
          }, 3000);
        }
        button.disabled = false;
      }
    );
  }

  function createButton(id) {
    const button = document.createElement("button");
    button.id = id;
    button.type = "button";
    button.textContent = BUTTON_LABEL;
    button.title = BUTTON_LABEL_FULL;
    button.setAttribute("aria-label", BUTTON_LABEL_FULL);
    button.addEventListener("click", handleAnalyzeClick);
    return button;
  }

  function removeButtonById(id) {
    const existing = document.getElementById(id);
    if (existing) existing.remove();
  }

  function ensureTitleButtonInjected() {
    const existing = document.getElementById(TITLE_BUTTON_ID);
    if (existing && document.contains(existing)) return; // 이미 삽입됨: 중복 생성 방지

    const topRow = findFirstMatch(TITLE_ANCHOR_SELECTORS);
    if (!topRow || !topRow.parentElement) return; // 아직 DOM 준비 전: 다음 MutationObserver 콜백에서 재시도

    if (existing) existing.remove(); // 옛 컨테이너에 붙어있던 유령 버튼 정리
    topRow.parentElement.insertBefore(createButton(TITLE_BUTTON_ID), topRow); // 제목과 액션 버튼 줄 사이
  }

  function ensureSidebarButtonInjected() {
    const existing = document.getElementById(SIDEBAR_BUTTON_ID);
    if (existing && document.contains(existing)) return; // 이미 삽입됨: 중복 생성 방지

    const container = findFirstMatch(SIDEBAR_CONTAINER_SELECTORS);
    if (!container) return; // 아직 DOM 준비 전: 다음 MutationObserver 콜백에서 재시도

    if (existing) existing.remove(); // 옛 컨테이너에 붙어있던 유령 버튼 정리
    container.prepend(createButton(SIDEBAR_BUTTON_ID)); // 우측 영역 최상단
  }

  function ensureButtonsInjected() {
    if (!isWatchPage()) {
      removeButtonById(TITLE_BUTTON_ID);
      removeButtonById(SIDEBAR_BUTTON_ID);
      return;
    }

    ensureTitleButtonInjected();
    ensureSidebarButtonInjected();
  }

  // MutationObserver 콜백은 매우 자주 호출될 수 있으므로 rAF로 한 프레임에
  // 한 번만 실제 삽입 로직을 실행하도록 묶는다.
  function scheduleEnsureButton() {
    if (insertionScheduled) return;
    insertionScheduled = true;
    requestAnimationFrame(() => {
      insertionScheduled = false;
      ensureButtonsInjected();
    });
  }

  // ---------------------------------------------------------------------
  // YouTube SPA 네비게이션 대응
  // ---------------------------------------------------------------------

  function setupNavigationWatchers() {
    // YouTube 라우터가 클라이언트 사이드 네비게이션을 마치면 document에 발생시키는 이벤트
    document.addEventListener("yt-navigate-finish", scheduleEnsureButton);

    // yt-navigate-finish만으로는 액션 바가 아직 렌더링되지 않은 타이밍을 놓칠 수 있어
    // DOM 변경을 함께 감시해 버튼이 사라지거나 아직 없으면 다시 삽입을 시도한다.
    const observer = new MutationObserver(scheduleEnsureButton);
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  // ---------------------------------------------------------------------
  // 초기화
  // ---------------------------------------------------------------------

  function init() {
    injectStyles();
    setupNavigationWatchers();
    scheduleEnsureButton();
  }

  init();
})();
