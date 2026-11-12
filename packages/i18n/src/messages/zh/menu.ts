import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/menu";

export const messages = {
  // The native application menu. Electron localizes its own `role:` entries from the operating
  // system, so only the custom items are here.
  "menu.stopAllAgents": "停止所有助手",
  "menu.checkForUpdates": "检查更新…",
  "menu.preferences": "设置…",
  "menu.actualSize": "实际大小",
  "menu.zoomIn": "放大",
  "menu.zoomOut": "缩小",
  "menu.copyLink": "复制链接",
  "menu.copyImage": "复制图片",
  "menu.quit": "退出 OpenBot",
  "menu.quitConfirmTitle": "退出 OpenBot？",
  "menu.quitConfirmBody": "在你再次打开 OpenBot 之前，助手和自动化任务会停止。",
  "menu.quitConfirm": "退出",
  "menu.quitHint": "按住 ⌘Q 或按两次以退出",
  "menu.trayOpen": "打开 OpenBot",
  "menu.trayQuit": "退出 OpenBot",
  "menu.trayTooltip": "OpenBot",
  "menu.hideDynamicIsland": "隐藏灵动岛",
  "menu.undo": "撤销",
  "menu.redo": "重做",
  "menu.cut": "剪切",
  "menu.copy": "复制",
  "menu.paste": "粘贴",
  "menu.pasteAndMatchStyle": "粘贴并匹配样式",
  "menu.delete": "删除",
  "menu.selectAll": "全选",
} as const satisfies PartialTranslation<typeof source>;
