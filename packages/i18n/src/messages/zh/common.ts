import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/common";

/**
 * Short words with no context of their own: a button or a menu item that means the same thing on
 * every screen. A word whose translation can change with the screen gets a key in that screen's
 * area instead, even when the English is the same.
 */
export const messages = {
  "common.cancel": "取消",
  "common.save": "保存",
  "common.close": "关闭",
  "common.delete": "删除",
  "common.remove": "移除",
  "common.edit": "编辑",
  "common.rename": "重命名",
  "common.retry": "重试",
  "common.copy": "复制",
  "common.copied": "已复制",
  "common.done": "完成",
  "common.back": "返回",
  "common.continue": "继续",
  "common.add": "添加",
  "common.create": "创建",
  "common.open": "打开",
  "common.search": "搜索",
  "common.noMatches": "无匹配项",
  "common.loading": "加载中…",
  "common.saving": "保存中…",
  "common.tryAgain": "重试",
  "common.connecting": "连接中…",
  "common.download": "下载",
  "common.removing": "移除中…",
  "common.sending": "发送中…",
} as const satisfies PartialTranslation<typeof source>;
