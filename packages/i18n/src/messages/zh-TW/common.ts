import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/common";

/**
 * Short words with no context of their own: a button or a menu item that means the same thing on
 * every screen. A word whose translation can change with the screen gets a key in that screen's
 * area instead, even when the English is the same.
 */
export const messages = {
  "common.cancel": "取消",
  "common.save": "儲存",
  "common.close": "關閉",
  "common.delete": "刪除",
  "common.remove": "移除",
  "common.edit": "編輯",
  "common.rename": "重新命名",
  "common.retry": "重試",
  "common.copy": "複製",
  "common.copied": "已複製",
  "common.done": "完成",
  "common.back": "返回",
  "common.continue": "繼續",
  "common.add": "新增",
  "common.create": "建立",
  "common.open": "開啟",
  "common.search": "搜尋",
  "common.noMatches": "無匹配項",
  "common.loading": "載入中…",
  "common.saving": "儲存中…",
  "common.tryAgain": "重試",
  "common.connecting": "連線中…",
  "common.download": "下載",
  "common.removing": "移除中…",
  "common.sending": "傳送中…",
} as const satisfies PartialTranslation<typeof source>;
