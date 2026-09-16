// ViewDigest - 채널 구독/RSS 피드 유틸리티
//
// background.js(service worker)에는 DOMParser가 없으므로, 채널 페이지 HTML과
// RSS 피드 XML을 모두 정규식으로 직접 파싱한다. YouTube의 채널 RSS 피드는
// API 키 없이 누구나 호출할 수 있는 공개 엔드포인트다.

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
    throw new Error("채널 URL 또는 ID를 입력해주세요.");
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
    throw new Error(`채널 페이지를 불러오지 못했습니다. (HTTP ${response.status})`);
  }
  const html = await response.text();

  const idMatch =
    html.match(/"channelId":"(UC[0-9A-Za-z_-]{22})"/) ??
    html.match(/youtube\.com\/channel\/(UC[0-9A-Za-z_-]{22})/);
  if (!idMatch) {
    throw new Error("채널 ID를 찾을 수 없습니다. 채널 URL이 올바른지 확인해주세요.");
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

/**
 * 채널의 최신 영상 목록을 조회한다 (기본 최대 5개, 최신순).
 */
async function fetchLatestVideos(channelId, maxResults = 5) {
  const response = await fetch(
    `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`
  );
  if (!response.ok) {
    throw new Error(`RSS 피드를 불러오지 못했습니다. (HTTP ${response.status})`);
  }
  const xml = await response.text();
  return parseVideoEntries(xml).slice(0, maxResults);
}

export { CHANNEL_ID_RE, resolveChannelId, fetchLatestVideos };
