import type { ChatVisualKey } from "@openbot/contracts/chat-visual";
import { isAgentNumberShortcutKey } from "@openbot/ui/features/sidebar/agent-number-shortcut";
import { isGlobalSearchShortcut } from "../../global-search-shortcut";
import { isOpenSettingsShortcut } from "../settings/settings-shortcut";

/**
 * The app shortcuts that a visual reply's page gives to the app while the page has the focus:
 * search, Settings, a server by its number and an agent by its number. The app's own handlers then
 * check the key again. Any other chord stays in the page.
 */
export function isChatVisualAppShortcut(key: ChatVisualKey): boolean {
  if (isGlobalSearchShortcut(key) || isOpenSettingsShortcut(key)) return true;
  // The page cannot report the platform, so both forms of the agent chord are forwarded here; the
  // app's handler checks the platform. It matches on `code`, because Option changes `key` on macOS.
  if (isAgentNumberShortcutKey(key)) return true;
  return (key.metaKey || key.ctrlKey) && !key.altKey && !key.shiftKey && /^[1-9]$/u.test(key.key);
}
