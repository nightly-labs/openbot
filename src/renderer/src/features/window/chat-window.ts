import type { ChatWindowTarget } from "@openbot/contracts/ipc";

/**
 * The chat that this window shows alone (#2964), or null in the main window. Main opens a chat
 * window at the app URL with `?window=chat&server=<id>&agent=<id>`.
 */
export function readChatWindowTarget(search: string): ChatWindowTarget | null {
  const query = new URLSearchParams(search);
  const serverId = query.get("server");
  const agentId = query.get("agent");
  if (query.get("window") !== "chat" || !serverId || !agentId) return null;
  return { serverId, agentId };
}
