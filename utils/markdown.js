// ViewDigest - 아주 작은 마크다운 → HTML 렌더러
// (외부 라이브러리 없이, Gemini가 생성하는 구조화된 리포트 포맷만 지원)
// popup.js와 results.js가 동일한 렌더링 결과를 공유하기 위해 여기로 분리했다.

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderInline(text) {
  let html = escapeHtml(text);

  // [텍스트](URL) 링크
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
  );

  // **굵게** / __굵게__
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/__(.+?)__/g, "<strong>$1</strong>");

  // *기울임* / _기울임_
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
  html = html.replace(/(?<![\w`])_(.+?)_(?![\w`])/g, "<em>$1</em>");

  // `인라인 코드`
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  return html;
}

const BLOCK_START_RE = /^(#{1,6})\s+|^\s*[-*]\s+|^\s*\d+\.\s+|^>\s?|^(-{3,}|\*{3,})\s*$/;

function renderMarkdown(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let list = null; // { type: "ul" | "ol", items: string[] }
  let i = 0;

  function flushList() {
    if (!list) return;
    const items = list.items.map((item) => `<li>${renderInline(item)}</li>`).join("");
    blocks.push(`<${list.type}>${items}</${list.type}>`);
    list = null;
  }

  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*$/.test(line)) {
      flushList();
      i++;
      continue;
    }

    const header = line.match(/^(#{1,6})\s+(.*)$/);
    if (header) {
      flushList();
      // 이 렌더러가 스타일을 갖는 건 h1~h4뿐이다. 예전에는 #을 4개까지만
      // 제목으로 인식해서, 모델이 "##### 소제목"을 쓰면 해시가 그대로 본문
      // 텍스트로 새어 나왔다. 더 깊은 단계는 h4로 맞춰 받는다.
      const level = Math.min(header[1].length, 4);
      blocks.push(`<h${level}>${renderInline(header[2])}</h${level}>`);
      i++;
      continue;
    }

    if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
      flushList();
      blocks.push("<hr>");
      i++;
      continue;
    }

    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      flushList();
      const quoteLines = [quote[1]];
      i++;
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      blocks.push(`<blockquote>${renderInline(quoteLines.join(" "))}</blockquote>`);
      continue;
    }

    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    if (ul) {
      if (!list || list.type !== "ul") {
        flushList();
        list = { type: "ul", items: [] };
      }
      list.items.push(ul[1]);
      i++;
      continue;
    }

    const ol = line.match(/^\s*\d+\.\s+(.*)$/);
    if (ol) {
      if (!list || list.type !== "ol") {
        flushList();
        list = { type: "ol", items: [] };
      }
      list.items.push(ol[1]);
      i++;
      continue;
    }

    // 문단: 다음 블록 시작 전까지의 줄을 한 문단으로 묶는다.
    flushList();
    const paragraph = [line];
    i++;
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !BLOCK_START_RE.test(lines[i])) {
      paragraph.push(lines[i]);
      i++;
    }
    blocks.push(`<p>${renderInline(paragraph.join(" "))}</p>`);
  }

  flushList();
  return blocks.join("\n");
}

export { renderMarkdown };
