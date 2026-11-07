/**
 * The size caps for tool text that goes to the model. A tool result stays in the context for each
 * later request of the session, so a large value costs again on each turn. The caps sit where OpenBot
 * builds the model's result; the engine caps (64 KB for an evaluate or script value) stay the safety
 * bound of the work itself.
 */

/** A browser `evaluate` or `run_script` value: about 4k tokens. */
export const BROWSER_VALUE_TEXT_LIMIT = 16_000;

/** A text item of a proxied MCP result: about 10k tokens, the default tool output limit of Codex. */
export const MCP_RESULT_TEXT_LIMIT = 40_000;

export const BROWSER_VALUE_MORE =
  "To read more, return less: select only the fields that you need, filter, or return a slice, such as JSON.stringify(value).slice(16000, 32000). In run_script, work on the data in the script and return only the answer.";

export const MCP_RESULT_MORE =
  "To read more, call the tool again with its pagination or filter arguments, such as a smaller page size or the next page.";

export interface ModelTextCut {
  /** The start of the text, at most the limit. */
  text: string;
  /** Says that the text was cut, how much the model got, and how to get more. */
  note: string;
}

/** The start of `text` and a note, or null when the text is in the limit. */
export function cutModelText(text: string, limit: number, more: string): ModelTextCut | null {
  if (text.length <= limit) return null;
  const code = text.charCodeAt(limit - 1);
  // The cut does not split a surrogate pair.
  const end = code >= 0xd800 && code <= 0xdbff ? limit - 1 : limit;
  return {
    text: text.slice(0, end),
    note: `[OpenBot cut this result: you got the first ${end} of ${text.length} characters. ${more}]`,
  };
}
