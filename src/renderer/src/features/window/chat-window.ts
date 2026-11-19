import type { ChatWindowTarget } from "@openbot/contracts/ipc";

export function readChatWindowTarget(search: string): ChatWindowTarget | null {
  const query = new URLSearchParams(search);
  const serverId = query.get("server");
  const agentId = query.get("agent");
  if (query.get("window") !== "chat" || !serverId || !agentId) return null;
  return { serverId, agentId };
}
