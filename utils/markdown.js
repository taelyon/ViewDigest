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

const HEADING_RE = /^(#{1,6})\s+(.*)$/;

// "1.", "1)", "1-1.", "Chapter 1.", "Section 1-1:" 처럼 모델이 제목에 직접 써 넣은
// 번호. 숫자 뒤에 구분기호나 공백이 와야 하므로 "2026년 전망" 같은 제목은 건드리지
// 않는다.
const HEADING_NUMBER_PREFIX_RE = /^\s*(?:chapter|section)?\s*\d+(?:\s*[-.–]\s*\d+)*\s*[.):]?\s+/i;

// 리포트를 구성하는 껍데기 제목. 내용을 담는 장(章)이 아니라 구획을 나누는
// 이름표이므로 번호에서 제외한다(프롬프트가 "목차"와 "상세 분석", 영어 리포트는
// "Table of Contents"와 "Detailed Analysis"를 요구한다).
const WRAPPER_HEADING_RE =
  /^(목차|차례|목록|상세\s*분석|분석\s*내용|table of contents|contents|outline|(detailed|in-depth)\s+analysis|analysis)$/i;

// 소주제 제목 끝에 프롬프트가 붙이게 한 영상 시각: "[12:34]", "[1:02:03]".
// 대괄호만 알아본다. 괄호 속 "9:00 발표" 같은 제목 내용과 섞이지 않게 하기 위해서다.
const HEADING_TIMESTAMP_RE = /\s*\[\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\s*\]\s*$/;

/**
 * 제목 끝의 영상 시각을 떼어낸다. 형식이 맞지 않는 값(분·초가 60 이상 등)은 제목의
 * 일부로 그대로 둔다.
 * @returns {{ text: string, seconds: number | null }}
 */
function splitHeadingTimestamp(text) {
  const match = text.match(HEADING_TIMESTAMP_RE);
  if (!match) return { text, seconds: null };
  const [hours, minutes, seconds] = [match[1] ?? "0", match[2], match[3]].map(Number);
  if ((match[1] !== undefined && minutes >= 60) || seconds >= 60) return { text, seconds: null };
  return { text: text.slice(0, match.index), seconds: hours * 3600 + minutes * 60 + seconds };
}

function formatTimestamp(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = String(totalSeconds % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

function stripHeadingNumber(text) {
  return text.replace(HEADING_NUMBER_PREFIX_RE, "").trim();
}

/**
 * 제목에 붙일 번호("1. ", "1-1 ")를 문서 전체를 보고 미리 계산한다.
 *
 * 번호를 CSS 카운터로 매기던 때는 "어느 제목이 대주제인가"를 알 수 없어서,
 * 리포트 제목과 목차까지 챕터로 세거나 소주제 단계가 달라지면 번호가 통째로
 * 어긋났다. 여기서는 문서에 실제로 쓰인 제목 단계를 보고 판단한다.
 *
 * - 모델이 직접 쓴 번호는 떼어내고 항상 여기서 새로 매긴다(이중 번호 방지).
 * - "목차"류 제목과, 다른 모든 제목보다 얕은 단계에 홀로 있는 첫 제목(리포트
 *   제목)은 번호에서 제외한다.
 * - 남은 제목 중 가장 얕은 단계를 대주제, 그 다음 단계를 소주제로 본다.
 */
function planHeadingNumbers(lines) {
  const headings = [];
  lines.forEach((line, index) => {
    const match = line.match(HEADING_RE);
    if (!match) return;
    const { text: withoutTime, seconds } = splitHeadingTimestamp(match[2]);
    headings.push({
      index,
      level: Math.min(match[1].length, 4),
      text: stripHeadingNumber(withoutTime),
      seconds,
      // 바로 뒤에 본문 없이 또 다른 제목이 오는가 — 리포트 제목을 가려내는 데 쓴다.
      leadsStraightToHeading: (() => {
        for (let i = index + 1; i < lines.length; i++) {
          if (/^\s*$/.test(lines[i])) continue;
          return HEADING_RE.test(lines[i]);
        }
        return false;
      })(),
    });
  });

  const text = new Map(headings.map((h) => [h.index, h.text]));
  const timestamps = new Map(
    headings.filter((h) => h.seconds !== null).map((h) => [h.index, h.seconds])
  );
  const prefixes = new Map();
  const chapterIndexes = new Set();
  const sectionIndexes = new Set();

  const candidates = headings.filter((h) => !WRAPPER_HEADING_RE.test(h.text));

  // 제목이 하나뿐이면 그건 리포트 제목이다. "1."을 붙여봐야 가리킬 대상이 없다.
  if (candidates.length < 2) return { text, timestamps, prefixes, chapterIndexes, sectionIndexes };

  // 리포트 제목은 번호에서 뺀다. 두 가지로 알아본다:
  //  - 나머지 어떤 제목보다도 얕은 단계에 홀로 있거나(현재 프롬프트 형식),
  //  - 대주제와 같은 단계지만, 본문 없이 곧바로 같거나 더 얕은 제목이 뒤따르는
  //    경우(제목 단계를 고정하기 전에 저장된 리포트가 이렇다).
  // "상세 분석" 같은 구획 이름표는 위에서 이름으로 이미 걸러졌으므로, 여기서는
  // 맨 앞 하나만 보면 된다.
  const [first, second] = candidates;
  const isLoneShallowest = first.level < Math.min(...candidates.slice(1).map((h) => h.level));
  const isBareTitleRow = first.leadsStraightToHeading && second.level <= first.level;
  if (isLoneShallowest || isBareTitleRow) candidates.shift();

  const levels = [...new Set(candidates.map((h) => h.level))].sort((a, b) => a - b);
  const [chapterLevel, sectionLevel] = levels;

  let chapter = 0;
  let section = 0;
  for (const heading of candidates) {
    if (heading.level === chapterLevel) {
      chapter += 1;
      section = 0;
      prefixes.set(heading.index, `${chapter}. `);
      chapterIndexes.add(heading.index);
    } else if (heading.level === sectionLevel && chapter > 0) {
      section += 1;
      prefixes.set(heading.index, `${chapter}-${section}. `);
      sectionIndexes.add(heading.index);
    }
  }

  return { text, timestamps, prefixes, chapterIndexes, sectionIndexes };
}

function renderMarkdown(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const {
    text: headingText,
    timestamps: headingTimestamps,
    prefixes: headingPrefixes,
    chapterIndexes,
    sectionIndexes,
  } = planHeadingNumbers(lines);
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

    const header = line.match(HEADING_RE);
    if (header) {
      flushList();
      // 이 렌더러가 스타일을 갖는 건 h1~h4뿐이다. 예전에는 #을 4개까지만
      // 제목으로 인식해서, 모델이 "##### 소제목"을 쓰면 해시가 그대로 본문
      // 텍스트로 새어 나왔다. 더 깊은 단계는 h4로 맞춰 받는다.
      const level = Math.min(header[1].length, 4);
      const prefix = headingPrefixes.get(i) ?? "";
      const body = renderInline(headingText.get(i) ?? header[2]);
      // 대주제/소주제가 h2·h3인지 h3·h4인지는 리포트마다 다르므로, 강조 스타일이
      // 태그가 아니라 역할을 따라가도록 표시해 둔다.
      let role = "";
      if (chapterIndexes.has(i)) role = ' class="report-chapter"';
      else if (sectionIndexes.has(i)) role = ' class="report-section"';
      // 영상 시각이 있으면 누르면 그 장면으로 이동하는 버튼을 붙인다(동작은 results.js).
      const seconds = headingTimestamps.get(i);
      const seek =
        seconds === undefined
          ? ""
          : ` <button type="button" class="timestamp-link" data-seconds="${seconds}">▶ ${formatTimestamp(seconds)}</button>`;
      blocks.push(`<h${level}${role}>${escapeHtml(prefix)}${body}${seek}</h${level}>`);
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
