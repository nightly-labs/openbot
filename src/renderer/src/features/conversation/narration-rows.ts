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
      ...(thinking.senderAgentId === undefined ? {} : { senderAgentId: thinking.senderAgentId }),
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

/**
 * Puts the progress updates and the steps row of each turn among the other rows, by time. Each
 * update goes before the first row that is newer. The steps row of a turn takes the time of its last
 * update, so it stays under them. A row with no time does not move an update.
 */
export function placeTurnRowsByTime(rows: readonly AgentMessage[], turns: readonly AgentMessage[][]): AgentMessage[] {
  const timed = turns.flatMap((turn) => {
    let at = "";
    return turn.map((row) => {
      if (row.kind !== "thinking" || !at) at = row.createdAt ?? at;
      return { row, at };
    });
  });
  if (timed.length === 0) return [...rows];
  // A stable sort keeps the order of a turn when its rows share a time.
  timed.sort((left, right) => (left.at < right.at ? -1 : left.at > right.at ? 1 : 0));
  const placed: AgentMessage[] = [];
  let next = 0;
  for (const row of rows) {
    const at = row.createdAt;
    for (let update = timed[next]; at && update && update.at < at; update = timed[++next]) placed.push(update.row);
    placed.push(row);
  }
  for (const { row } of timed.slice(next)) placed.push(row);
  return placed;
}
