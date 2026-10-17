import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/menu";

export const messages = {
  // The native application menu. Electron localizes its own `role:` entries from the operating
  // system, so only the custom items are here.
  "menu.stopAllAgents": "停止所有助手",
  "menu.checkForUpdates": "检查更新…",
  "menu.preferences": "设置…",
  "menu.copyLink": "复制链接",
} as const satisfies PartialTranslation<typeof source>;
