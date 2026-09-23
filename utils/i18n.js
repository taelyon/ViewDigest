// ViewDigest - 화면 문구 다국어 처리 (chrome.i18n)
//
// 문구는 _locales/<언어>/messages.json에 있다. Chrome이 브라우저 언어에 맞는
// 파일을 고르고, 없는 언어면 manifest의 default_locale(en)로 대체한다.
// content.js는 모듈이 아니어서 이 파일을 import할 수 없으므로 chrome.i18n을 직접 쓴다.

/**
 * 문구 키에 해당하는 현재 언어의 문장. 치환값은 메시지의 $1, $2 … 자리에 들어간다.
 * 키가 없으면 빈 화면 대신 키 이름을 돌려줘, 빠진 문구가 눈에 띄게 한다.
 */
function t(key, ...substitutions) {
  return chrome.i18n.getMessage(key, substitutions.map(String)) || key;
}

/**
 * 실제로 화면에 쓰이는 문구의 언어("ko" / "en"). 브라우저 언어가 일본어처럼
 * 지원하지 않는 언어일 때는 문구가 영어로 대체되므로, 날짜 형식도 그에 맞춘다.
 */
function displayLanguage() {
  return t("htmlLang");
}

const ATTRIBUTE_BINDINGS = [
  ["data-i18n-title", "title"],
  ["data-i18n-placeholder", "placeholder"],
];

/**
 * HTML에 표시해 둔 요소들의 문구를 현재 언어로 채운다.
 *   data-i18n="키"              → 텍스트
 *   data-i18n-html="키"         → HTML (링크가 들어간 문장용. 메시지 파일은 우리가 쓴 것이다)
 *   data-i18n-title="키"        → title 속성
 *   data-i18n-placeholder="키"  → placeholder 속성
 */
function localizePage(root = document) {
  document.documentElement.lang = displayLanguage();

  root.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  root.querySelectorAll("[data-i18n-html]").forEach((el) => {
    el.innerHTML = t(el.dataset.i18nHtml);
  });
  for (const [marker, attr] of ATTRIBUTE_BINDINGS) {
    root.querySelectorAll(`[${marker}]`).forEach((el) => {
      el.setAttribute(attr, t(el.getAttribute(marker)));
    });
  }
}

function formatDateTime(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(displayLanguage(), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export { t, displayLanguage, localizePage, formatDateTime };
