import { type MarkdownListEdit, markdownListLineBreak } from "@openbot/contracts/markdown-lists";

/**
 * The list edit for a Return key press, when `next` is `previous` with one line break at the caret.
 * Any other change, such as a paste or dictation, keeps the text as typed.
 */
export function markdownListReturn(previous: string, next: string, caret: number): MarkdownListEdit | null {
  if (caret < 0 || next !== `${previous.slice(0, caret)}\n${previous.slice(caret)}`) return null;
  return markdownListLineBreak(previous, caret);
}
