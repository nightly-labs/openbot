import type { ChatVisualKey } from "@openbot/contracts/chat-visual";
import { isAgentSwitchChord } from "../../agent-switch-shortcut";
import { isGlobalSearchShortcut } from "../../global-search-shortcut";
import { isOpenSettingsShortcut } from "../settings/settings-shortcut";

/**
 * The app shortcuts that a visual reply's page gives to the app while the page has the focus:
 * search, Settings, and a server or an agent by its number. The app's own handlers then check the key again.
 * Any other chord stays in the page.
 */
export function isChatVisualAppShortcut(key: ChatVisualKey): boolean {
  if (isGlobalSearchShortcut(key) || isOpenSettingsShortcut(key) || isAgentSwitchChord(key)) return true;
  return (key.metaKey || key.ctrlKey) && !key.altKey && !key.shiftKey && /^[1-9]$/u.test(key.key);
}
