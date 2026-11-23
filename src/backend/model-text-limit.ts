export const BROWSER_VALUE_TEXT_LIMIT = 16_000;

export const MCP_RESULT_TEXT_LIMIT = 40_000;

const BROWSER_VALUE_PART = 12_000;

const returnLess = (start: number): string =>
  `return less: select only the fields that you need, filter, or return a slice, such as JSON.stringify(value).slice(${start}, ${start + BROWSER_VALUE_PART}). In run_script, work on the data in the script and return only the answer.`;

export const BROWSER_VALUE_MORE = (end: number): string => `To read more, ${returnLess(end)}`;

export const BROWSER_STRING_MORE = (end: number): string =>
  `To read more, return the same string from its character ${end}. When the string was a slice from offset N, the next slice starts at N + ${end}.`;

export const BROWSER_VALUE_TOO_LARGE = `To get it, ${returnLess(0)}`;

export const MCP_RESULT_MORE = (): string =>
  "To read more, call the tool again with its pagination or filter arguments, such as a smaller page size or the next page. For a large file, clone the repository and read the file there.";

export interface ModelTextCut {
  text: string;
  note: string;
}

export function cutModelText(text: string, limit: number, more: (end: number) => string): ModelTextCut | null {
  if (text.length <= limit) return null;
  const code = text.charCodeAt(limit - 1);
  const end = code >= 0xd800 && code <= 0xdbff ? limit - 1 : limit;
  return {
    text: text.slice(0, end),
    note: `[OpenBot cut this result: you got the first ${end} of ${text.length} characters. ${more(end)}]`,
  };
}

export function jsonStringFit(text: string, limit: number): number {
  let fits = 1;
  let tooLong = Math.min(text.length, limit) + 1;
  while (tooLong - fits > 1) {
    const middle = Math.floor((fits + tooLong) / 2);
    if (JSON.stringify(text.slice(0, middle)).length <= limit) fits = middle;
    else tooLong = middle;
  }
  return fits;
}
