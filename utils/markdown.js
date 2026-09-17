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

/**
 * "00:00" / "12:34" / "1:02:03" 형태의 타임스탬프를 초 단위로 변환.
 * 형식이 아니면 null을 반환한다.
 */
function timestampToSeconds(text) {
  const parts = text.split(":").map(Number);
  if (parts.some((n) => Number.isNaN(n))) return null;

  if (parts.length === 2) {
    const [m, s] = parts;
    return m * 60 + s;
  }
  if (parts.length === 3) {
    const [h, m, s] = parts;
    return h * 3600 + m * 60 + s;
  }
  return null;
}

function renderInline(text) {
  let html = escapeHtml(text);

  // 타임스탬프를 가장 먼저 처리해, 이후 마크다운 치환이 만든 태그와 섞이지 않게 한다.
  html = html.replace(/\b(\d{1,2}(?::\d{2}){1,2})\b/g, (match) => {
    const seconds = timestampToSeconds(match);
    if (seconds === null) return match;
    return `<span class="timestamp-link" data-seconds="${seconds}" role="button" tabindex="0">${match}</span>`;
  });

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

const BLOCK_START_RE = /^(#{1,4})\s+|^\s*[-*]\s+|^\s*\d+\.\s+|^>\s?|^(-{3,}|\*{3,})\s*$/;

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

    const header = line.match(/^(#{1,4})\s+(.*)$/);
    if (header) {
      flushList();
      const level = header[1].length;
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
