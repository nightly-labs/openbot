import type { AgentProviderRef } from "@openbot/contracts/agent-providers";
import { isNarrationItemId } from "@openbot/contracts/conversation-narration";
import type { AgentMessage } from "@openbot/ui/data";
import { formatMessageTime } from "../../app-message-projection";

/**
 * The narration of a `thinking` row as rows of their own, in order. A row is still a step of the
 * turn: with `itemType: "commentary"` the timeline gives it no stored-message actions.
 */
export function narrationRows(thinking: AgentMessage, provider: AgentProviderRef | undefined): AgentMessage[] {
  const items = thinking.items ?? [];
  const rows: AgentMessage[] = [];
  for (const [index, body] of items.entries()) {
    const id = thinking.itemIds?.[index];
    if (!id || !body.trim() || !isNarrationItemId(id, provider)) continue;
    const createdAt = thinking.itemCreatedAt?.[index];
    rows.push({
      id,
      ...(thinking.turnId === undefined ? {} : { turnId: thinking.turnId }),
      author: "agent",
      body,
      time: createdAt ? formatMessageTime(createdAt) : thinking.time,
      ...(createdAt ? { createdAt } : {}),
      streaming: thinking.itemStreaming?.[index] === true,
      itemType: "commentary",
      kind: "text",
      // A row that arrives while the chat is open enters as a new message does. The timeline plays
      // the entrance once for each id, so an update enters when it arrives, not when the next one does.
      animate: thinking.animate,
    });
  }
  return rows;
}
