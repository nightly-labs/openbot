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

/**
 * The size of a part that a note asks for. A part is a string, and its JSON form with the escapes is
 * longer, so a part of this size usually fits in the limit.
 */
const BROWSER_VALUE_PART = 12_000;

/** Says how to get a value in parts, from `start`. */
const returnLess = (start: number): string =>
  `return less: select only the fields that you need, filter, or return a slice, such as JSON.stringify(value).slice(${start}, ${start + BROWSER_VALUE_PART}). In run_script, work on the data in the script and return only the answer.`;

/** Says how to read the rest of a value; `end` is the length of the start of its JSON that the model got. */
export const BROWSER_VALUE_MORE = (end: number): string => `To read more, ${returnLess(end)}`;

/** Says how to read the rest of a string value; `end` counts characters of that string. */
export const BROWSER_STRING_MORE = (end: number): string =>
  `To read more, return the same string from its character ${end}. When the string was a slice from offset N, the next slice starts at N + ${end}.`;

/** Says how to get a value that is larger than the engine limit, which gives no part of it. */
export const BROWSER_VALUE_TOO_LARGE = `To get it, ${returnLess(0)}`;

export const MCP_RESULT_MORE = (): string =>
  "To read more, call the tool again with its pagination or filter arguments, such as a smaller page size or the next page. For a large file, clone the repository and read the file there.";

export interface ModelTextCut {
  /** The start of the text, at most the limit. */
  text: string;
  /** Says that the text was cut, how much the model got, and how to get more. */
  note: string;
}

/** The start of `text` and a note, or null when the text is in the limit. */
export function cutModelText(text: string, limit: number, more: (end: number) => string): ModelTextCut | null {
  if (text.length <= limit) return null;
  const code = text.charCodeAt(limit - 1);
  // The cut does not split a surrogate pair.
  const end = code >= 0xd800 && code <= 0xdbff ? limit - 1 : limit;
  return {
    text: text.slice(0, end),
    note: `[OpenBot cut this result: you got the first ${end} of ${text.length} characters. ${more(end)}]`,
  };
}

/**
 * The length of the longest start of `text` whose JSON string form, with quotes and escapes, has at
 * most `limit` characters. That form is what the model reads of a string value.
 */
export function jsonStringFit(text: string, limit: number): number {
  // The escaped length grows with the length of the start, and one character always fits.
  let fits = 1;
  let tooLong = Math.min(text.length, limit) + 1;
  while (tooLong - fits > 1) {
    const middle = Math.floor((fits + tooLong) / 2);
    if (JSON.stringify(text.slice(0, middle)).length <= limit) fits = middle;
    else tooLong = middle;
  }
  return fits;
}
