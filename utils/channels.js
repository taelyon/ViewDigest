// ViewDigest - 채널 구독/RSS 피드 유틸리티
//
// background.js(service worker)에는 DOMParser가 없으므로, 채널 페이지 HTML과
// RSS 피드 XML을 모두 정규식으로 직접 파싱한다. YouTube의 채널 RSS 피드는
// API 키 없이 누구나 호출할 수 있는 공개 엔드포인트다.
//
// 다만 그 RSS는 멀쩡한 채널에도 한동안 404를 돌려주는 일이 있다(실제로 구독 채널
// 여러 곳이 동시에 그랬다). 그래서 최신 영상 목록은 여러 경로를 차례로 시도한다:
// 채널 RSS → 업로드 재생목록 RSS → 채널 "동영상" 탭 페이지.

import { t } from "./i18n.js";

const CHANNEL_ID_RE = /^UC[0-9A-Za-z_-]{22}$/;

function decodeHtmlEntities(text) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * 사용자가 입력한 값(채널ID/전체 URL/@핸들)을 채널 페이지 URL로 정규화한다.
 */
function buildChannelPageUrl(input) {
  const trimmed = input.trim();
  if (/^https?:\/\//.test(trimmed)) return trimmed;
  if (CHANNEL_ID_RE.test(trimmed)) return `https://www.youtube.com/channel/${trimmed}`;
  const handle = trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
  return `https://www.youtube.com/${handle}`;
}

/**
 * 채널 ID / 채널 URL(/channel/UC..., /@handle, /c/이름, /user/이름) 중
 * 무엇을 입력받든 실제 channelId(UC...)와 채널 제목을 알아낸다.
 * 이미 channelId 형식이면 네트워크 요청 없이 바로 반환한다.
 */
async function resolveChannelId(input) {
  if (!input || !input.trim()) {
    throw new Error(t("channelEnterInput"));
  }

  const trimmed = input.trim();
  if (CHANNEL_ID_RE.test(trimmed)) {
    return {
      channelId: trimmed,
      title: trimmed,
      url: `https://www.youtube.com/channel/${trimmed}`,
    };
  }

  const pageUrl = buildChannelPageUrl(trimmed);
  const response = await fetch(pageUrl, { credentials: "omit" });
  if (!response.ok) {
    throw new Error(t("channelPageFailed", response.status));
  }
  const html = await response.text();

  const idMatch =
    html.match(/"channelId":"(UC[0-9A-Za-z_-]{22})"/) ??
    html.match(/youtube\.com\/channel\/(UC[0-9A-Za-z_-]{22})/);
  if (!idMatch) {
    throw new Error(t("channelIdNotFound"));
  }
  const channelId = idMatch[1];

  const titleMatch = html.match(/<meta property="og:title" content="([^"]+)"/);
  const title = titleMatch ? decodeHtmlEntities(titleMatch[1]) : channelId;

  return { channelId, title, url: `https://www.youtube.com/channel/${channelId}` };
}

/**
 * RSS 피드 XML에서 <entry> 블록들을 최신순으로 파싱한다.
 */
function parseVideoEntries(xml) {
  const entries = [];
  const blocks = xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? [];

  for (const block of blocks) {
    const videoId = block.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1];
    if (!videoId) continue;
    const title = block.match(/<title>([^<]*)<\/title>/)?.[1];
    const published = block.match(/<published>([^<]+)<\/published>/)?.[1];

    entries.push({
      videoId,
      title: title ? decodeHtmlEntities(title) : videoId,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      publishedAt: published ?? null,
    });
  }

  return entries; // 피드는 이미 최신 영상이 먼저 오는 순서
}

const FEED_URL = "https://www.youtube.com/feeds/videos.xml";

function sourceHttpError(sourceName, status) {
  return new Error(t("channelSourceHttp", sourceName, status));
}

async function fetchFeed(query) {
  const response = await fetch(`${FEED_URL}?${query}`);
  if (!response.ok) throw sourceHttpError("RSS", response.status);
  // 200이면 영상이 0개여도(아직 영상이 없는 채널) 그대로 믿는다.
  return parseVideoEntries(await response.text());
}

/**
 * HTML 안에서 `ytInitialData = {...}`의 객체 부분만 잘라 JSON으로 파싱한다.
 * 객체 뒤에 무엇이 오든 상관없도록, 문자열 안의 괄호는 건너뛰며 중괄호 짝을 센다.
 */
function extractInitialData(html) {
  // yt-dlp가 쓰는 것과 같은 위치 표시(window["ytInitialData"] = 형태도 있다).
  const marker = /(?:window\s*\[\s*["']ytInitialData["']\s*\]|ytInitialData)\s*=\s*/.exec(html);
  if (!marker) return null;
  const start = marker.index + marker[0].length;
  if (html[start] !== "{") return null;

  let depth = 0;
  let inString = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}" && --depth === 0) {
      try {
        return JSON.parse(html.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function runsText(text) {
  if (!text) return null;
  return text.simpleText ?? text.runs?.map((run) => run.text).join("") ?? text.content ?? null;
}

/**
 * ytInitialData 전체를 문서 순서대로 훑어 영상 항목을 모은다. YouTube는 채널 페이지의
 * 구조(탭 → 그리드 → 항목)를 자주 바꾸므로 경로를 고정하지 않고, 영상 항목 자체의
 * 모양 두 가지만 알아본다: 예전 videoRenderer와 새 lockupViewModel.
 */
function collectPageVideos(node, videos, seen) {
  if (Array.isArray(node)) {
    for (const item of node) collectPageVideos(item, videos, seen);
    return;
  }
  if (!node || typeof node !== "object") return;

  const add = (videoId, title) => {
    if (!videoId || seen.has(videoId)) return;
    seen.add(videoId);
    videos.push({
      videoId,
      title: title ?? videoId,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      publishedAt: null,
    });
  };

  const renderer = node.videoRenderer;
  if (renderer?.videoId) add(renderer.videoId, runsText(renderer.title));

  const lockup = node.lockupViewModel;
  if (lockup?.contentId && lockup.contentType === "LOCKUP_CONTENT_TYPE_VIDEO") {
    add(lockup.contentId, runsText(lockup.metadata?.lockupMetadataViewModel?.title));
  }

  for (const value of Object.values(node)) collectPageVideos(value, videos, seen);
}

/**
 * 채널의 "동영상" 탭(최신순)에서 영상 목록을 읽는다. 쇼츠와 라이브는 이 탭에 없다.
 */
async function fetchChannelPageVideos(channelId) {
  const pageName = t("channelSourcePage");
  const response = await fetch(`https://www.youtube.com/channel/${encodeURIComponent(channelId)}/videos`, {
    credentials: "omit",
  });
  if (!response.ok) throw sourceHttpError(pageName, response.status);

  const data = extractInitialData(await response.text());
  const videos = [];
  if (data) collectPageVideos(data, videos, new Set());
  if (videos.length === 0) throw new Error(t("channelPageNoVideos"));
  return videos;
}

/**
 * 채널의 최신 영상 목록을 조회한다 (최신순).
 *
 * @returns {Promise<{source: "rss" | "page", videos: Array}>} source는 어느 경로로
 *   읽었는지다. "page"(동영상 탭)에는 쇼츠·라이브가 없어 RSS와 목록이 다를 수 있다.
 * @throws 모든 경로가 실패하면 경로별 실패 사유를 모은 메시지로 던진다.
 */
async function fetchLatestVideos(channelId, maxResults = 15) {
  const uploadsPlaylistId = `UU${channelId.slice(2)}`;
  const attempts = [
    ["rss", () => fetchFeed(`channel_id=${encodeURIComponent(channelId)}`)],
    ["rss", () => fetchFeed(`playlist_id=${encodeURIComponent(uploadsPlaylistId)}`)],
    ["page", () => fetchChannelPageVideos(channelId)],
  ];

  const failures = [];
  for (const [source, load] of attempts) {
    try {
      const videos = await load();
      return { source, videos: videos.slice(0, maxResults) };
    } catch (error) {
      failures.push(error.message);
    }
  }
  throw new Error(t("channelVideosFailed", [...new Set(failures)].join(" · ")));
}

export { CHANNEL_ID_RE, resolveChannelId, fetchLatestVideos, extractInitialData, collectPageVideos };
