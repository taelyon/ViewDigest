// ViewDigest - 화면 테마(다크/라이트) 적용
//
// 모든 확장 페이지(팝업·결과·설정)의 <head>에서 일반 스크립트로 CSS보다 먼저 불러,
// 첫 화면부터 맞는 테마로 그린다(늦게 바꾸면 어두운 화면이 잠깐 번쩍인다).
// 설정의 기준은 chrome.storage의 settings.theme("dark" | "light" | "system")이고,
// 페이지를 그리기 전에 동기로 읽을 수 있도록 localStorage에 사본을 둔다.

(function () {
  const COPY_KEY = "viewdigest-theme";
  const THEMES = ["dark", "light", "system"];
  const systemLight = window.matchMedia("(prefers-color-scheme: light)");
  let choice = "dark";
  try {
    choice = localStorage.getItem(COPY_KEY) || "dark";
  } catch {
    // localStorage를 못 쓰면 기본(다크)으로 그리고, 아래에서 저장소 값으로 맞춘다.
  }

  function apply() {
    const light = choice === "light" || (choice === "system" && systemLight.matches);
    document.documentElement.dataset.theme = light ? "light" : "dark";
  }

  function use(next) {
    const theme = THEMES.includes(next) ? next : "dark";
    try {
      localStorage.setItem(COPY_KEY, theme);
    } catch {}
    if (theme === choice) return;
    choice = theme;
    apply();
  }

  apply();
  systemLight.addEventListener("change", apply);

  // 사본이 없거나 오래된 경우 저장소 값으로 맞추고, 설정 페이지에서 바꾸면 열려 있는 페이지에도
  // 바로 반영한다.
  chrome.storage.local.get("settings").then(({ settings }) => use(settings?.theme));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.settings) use(changes.settings.newValue?.theme);
  });
})();
