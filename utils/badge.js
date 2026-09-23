// ViewDigest - 툴바 아이콘 배지
//
// 채널 자동 분석으로 새 리포트가 생겼는데 사용자가 아직 보지 않았으면, 확장프로그램
// 아이콘에 그 개수를 숫자로 띄운다. 배지 글자는 브라우저를 다시 켜면 사라지므로
// 개수는 storage에 두고(getUnseenIds), 여기서는 그 값을 아이콘에 그리기만 한다.

import { getHistory, getUnseenIds, setUnseenIds } from "./storage.js";
import { t } from "./i18n.js";

const BADGE_BACKGROUND = "#7C3AED";
const BADGE_TEXT = "#FFFFFF";

/**
 * 확인하지 않은 자동 분석 개수를 배지와 아이콘 툴팁에 반영하고 그 개수를 돌려준다.
 * 그 사이 히스토리에서 지워졌거나(개별 삭제, 50개 초과로 밀려남) 없어진 항목은
 * 목록에서도 빼, 존재하지 않는 리포트를 세지 않게 한다.
 */
async function refreshBadge() {
  const [ids, history] = await Promise.all([getUnseenIds(), getHistory()]);
  const existing = new Set(history.map((entry) => entry.id));
  const unseen = ids.filter((id) => existing.has(id));
  if (unseen.length !== ids.length) await setUnseenIds(unseen);

  const count = unseen.length;
  await chrome.action.setBadgeBackgroundColor({ color: BADGE_BACKGROUND });
  // setBadgeTextColor는 Chrome 110부터 있다. 없으면 Chrome이 배경색에 맞춰 고른다.
  await chrome.action.setBadgeTextColor?.({ color: BADGE_TEXT });
  await chrome.action.setBadgeText({ text: count > 0 ? String(count) : "" });
  await chrome.action.setTitle({ title: count > 0 ? t("actionTitleUnseen", count) : "ViewDigest" });
  return count;
}

export { refreshBadge };
