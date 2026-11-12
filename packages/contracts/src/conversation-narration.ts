import type { AgentProviderRef } from "./agent-providers";

/**
 * The ids of the text an agent writes between its steps (its narration), beside its thinking:
 * Claude `<turn>:narration:<n>`, the ACP agents `<turn>:assistant` and `<turn>:assistant:<n>`, and
 * Pi `<message>:text:<n>`. An id that is not one of these, such as a thinking id, stays in the
 * steps, so no thinking shows as a message. Grok thoughts (`<turn>:thought:<n>`) are its reasoning,
 * such as tests of a shell error, so they also stay there.
 */
const NARRATION_ITEM_ID = /:(?:narration:\d+|assistant(?::\d+)?|text:\d+)$/u;

/**
 * Codex sends its reasoning and its short messages to the user both as commentary. Only the
 * Responses item id tells them apart: `rs_<hex>` is reasoning, `msg_<hex>` is a message.
 */
const CODEX_MESSAGE_ITEM_ID = /^msg_[0-9a-f]+$/u;

/** Whether a commentary item is the agent's narration, which a person can read, not its thinking. */
export function isNarrationItemId(id: string | undefined, provider: AgentProviderRef | undefined): boolean {
  if (id === undefined) return false;
  if (NARRATION_ITEM_ID.test(id)) return true;
  return provider === "codex" && CODEX_MESSAGE_ITEM_ID.test(id);
}
