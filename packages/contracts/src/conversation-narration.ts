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

/** The letters and digits of a text; spaces, marks and symbols are not content. */
const CONTENT_CHARACTER = /[\p{L}\p{N}]/gu;

/**
 * Whether a finished note of a turn shows as a progress update. A note with fewer than two letters or
 * digits is filler: a model wrote "x" before each step of a routine run, and the chat filled with them
 * (#10567). A note that repeats the text of a note the turn already showed adds nothing either.
 * `shown` holds the texts that the turn showed: keep one set for each turn. A note that shows is
 * added to it. A note that does not show stays in the turn's steps.
 */
export function showsNarration(text: string, shown: Set<string>): boolean {
  const key = text.replace(/\s+/gu, " ").trim();
  if ((key.match(CONTENT_CHARACTER)?.length ?? 0) < 2 || shown.has(key)) return false;
  shown.add(key);
  return true;
}
