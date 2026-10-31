import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/menu";

export const messages = {
  // The native application menu. Electron localizes its own `role:` entries from the operating
  // system, so only the custom items are here.
  "menu.stopAllAgents": "停止所有助理",
  "menu.checkForUpdates": "檢查更新…",
  "menu.preferences": "設定…",
  "menu.actualSize": "實際大小",
  "menu.zoomIn": "放大",
  "menu.zoomOut": "縮小",
  "menu.copyLink": "複製連結",
  "menu.trayOpen": "開啟 OpenBot",
  "menu.trayQuit": "退出 OpenBot",
  "menu.trayTooltip": "OpenBot",
  "menu.undo": "撤銷",
  "menu.redo": "重做",
  "menu.cut": "剪下",
  "menu.copy": "複製",
  "menu.paste": "貼上",
  "menu.pasteAndMatchStyle": "貼上並匹配樣式",
  "menu.delete": "刪除",
  "menu.selectAll": "全選",
} as const satisfies PartialTranslation<typeof source>;
