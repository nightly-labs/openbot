import type { ChatVisualKey } from "@openbot/contracts/chat-visual";
import { isGlobalSearchShortcut } from "../../global-search-shortcut";
import { isOpenSettingsShortcut } from "../settings/settings-shortcut";

export function isChatVisualAppShortcut(key: ChatVisualKey): boolean {
  if (isGlobalSearchShortcut(key) || isOpenSettingsShortcut(key)) return true;
  return (key.metaKey || key.ctrlKey) && !key.altKey && !key.shiftKey && /^[1-9]$/u.test(key.key);
}
