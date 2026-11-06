import type { AgentProviderRef } from "@openbot/contracts/agent-providers";
import type { AgentMessage } from "@openbot/ui/data";
import { formatMessageTime } from "../../app-message-projection";

/**
 * The ids of the text an agent writes between its steps (its narration), beside its thinking in the
 * same `thinking` row: Claude `<turn>:narration:<n>`, the ACP agents `<turn>:assistant` and
 * `<turn>:assistant:<n>`, and Pi `<message>:text:<n>`. An id that is not one of these, such as a
 * thinking id, stays in the steps, so no thinking shows as a message. Grok thoughts
 * (`<turn>:thought:<n>`) are its reasoning, such as tests of a shell error, so they also stay there.
 */
const NARRATION_ITEM_ID = /:(?:narration:\d+|assistant(?::\d+)?|text:\d+)$/u;

/**
 * Codex sends its reasoning and its short messages to the user both as commentary. Only the
 * Responses item id tells them apart: `rs_<hex>` is reasoning, `msg_<hex>` is a message.
 */
const CODEX_MESSAGE_ITEM_ID = /^msg_[0-9a-f]+$/u;

export function isNarrationItemId(id: string | undefined, provider: AgentProviderRef | undefined): boolean {
  if (id === undefined) return false;
  if (NARRATION_ITEM_ID.test(id)) return true;
  return provider === "codex" && CODEX_MESSAGE_ITEM_ID.test(id);
}

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
      itemType: "commentary",
      kind: "text",
      // A row that arrives while the chat is open enters as a new message does. The timeline plays
      // the entrance once for each id, so an update enters when it arrives, not when the next one does.
      animate: thinking.animate,
    });
  }
  return rows;
}
