// ViewDigest - YouTube 페이지 content script
//
// 이 스크립트는 일반 script(non-module)로 주입되므로 utils/*.js 의 ES export를
// 직접 import할 수 없다. Gemini 호출 등 무거운 로직은 background.js 에서
// utils/gemini.js 를 통해 처리하고, 여기서는 메시지만 주고받는다.
//
// 역할:
//   1. YouTube 영상 시청 페이지에 "⚡ 영상 분석" 버튼 삽입
//   2. 버튼 클릭 시 background.js 로 { action: "openResultsTab", url } 전송해
//      새 탭(results/results.html)을 열게 한다. 실제 분석/스트리밍 렌더링은
//      그 탭이 직접 수행하므로, 여기서는 탭을 여는 것까지만 책임진다.

(function () {
  const BUTTON_ID = "viewdigest-analyze-button";
  const STYLE_ID = "viewdigest-analyze-button-style";
  // YouTube의 다른 액션 버튼(좋아요/공유/저장 등)과 나란히 들어가는 좁은
  // flex 컨테이너에 삽입되므로, 라벨이 길면 그 버튼들을 다음 줄로 밀어낸다.
  // 화면에는 짧은 라벨만 쓰고, 전체 설명은 title 툴팁으로 제공한다.
  const BUTTON_LABEL = "⚡ 영상 분석";
  const BUTTON_LABEL_FULL = "초고밀도 분석 노트 생성";

  // YouTube DOM 구조는 자주 바뀌므로, 우선순위대로 여러 삽입 지점을 시도한다.
  const INSERTION_SELECTORS = [
    "ytd-watch-metadata #top-row #actions #actions-inner",
    "ytd-watch-metadata #actions #actions-inner",
    "ytd-watch-metadata #actions",
    "#above-the-fold #actions",
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

  function findInsertionPoint() {
    for (const selector of INSERTION_SELECTORS) {
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
      #${BUTTON_ID} {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        margin: 8px 8px 8px 0;
        padding: 0 16px;
        height: 36px;
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
      }
      #${BUTTON_ID}:hover:not(:disabled) {
        filter: brightness(1.08);
        transform: translateY(-1px);
      }
      #${BUTTON_ID}:active:not(:disabled) {
        transform: translateY(0);
      }
      #${BUTTON_ID}:disabled {
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

  function createButton() {
    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.textContent = BUTTON_LABEL;
    button.title = BUTTON_LABEL_FULL;
    button.addEventListener("click", handleAnalyzeClick);
    return button;
  }

  function removeButton() {
    const existing = document.getElementById(BUTTON_ID);
    if (existing) existing.remove();
  }

  function ensureButtonInjected() {
    if (!isWatchPage()) {
      removeButton();
      return;
    }

    const existing = document.getElementById(BUTTON_ID);
    if (existing && document.contains(existing)) return; // 이미 삽입됨: 중복 생성 방지

    const target = findInsertionPoint();
    if (!target) return; // 아직 DOM 준비 전: 다음 MutationObserver 콜백에서 재시도

    if (existing) existing.remove(); // 옛 컨테이너에 붙어있던 유령 버튼 정리
    target.prepend(createButton());
  }

  // MutationObserver 콜백은 매우 자주 호출될 수 있으므로 rAF로 한 프레임에
  // 한 번만 실제 삽입 로직을 실행하도록 묶는다.
  function scheduleEnsureButton() {
    if (insertionScheduled) return;
    insertionScheduled = true;
    requestAnimationFrame(() => {
      insertionScheduled = false;
      ensureButtonInjected();
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
