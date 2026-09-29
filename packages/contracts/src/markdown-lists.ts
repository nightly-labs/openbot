/**
 * The Markdown list edit that desktop, web and mobile composers make for a line break, so each app
 * continues and ends a list the same way.
 *
 * A line break after a list item with text starts the next item: `- `, `* `, `+ `, `1. ` or `1) `,
 * with the same indent, the next number, and an empty task box after a task item. A line break on
 * an item with no text removes its marker, which ends the list and leaves the line empty. The next
 * line break is then a plain one, so blank lines stay possible. Inside a fenced code block, and on a
 * thematic break such as `- - -`, a line break is always plain.
 */
export interface MarkdownListEdit {
  text: string;
  /** The caret offset in `text` after the edit. */
  caret: number;
}

const LIST_ITEM = /^([ \t]*)(?:([-*+])|(\d{1,9})([.)]))([ \t]+)(\[[ xX]\][ \t]+)?/u;
const THEMATIC_BREAK = /^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/u;
const CODE_FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/u;

/** The edit for a line break typed at `caret` in `text`, or null when the line break is plain. */
export function markdownListLineBreak(text: string, caret: number): MarkdownListEdit | null {
  const lineStart = text.lastIndexOf("\n", caret - 1) + 1;
  const nextBreak = text.indexOf("\n", caret);
  const lineEnd = nextBreak === -1 ? text.length : nextBreak;
  const line = text.slice(lineStart, lineEnd);
  if (THEMATIC_BREAK.test(line) || insideCodeFence(text.slice(0, lineStart))) return null;
  const item = LIST_ITEM.exec(line);
  if (!item || lineStart + item[0].length > caret) return null;

  const [marker, indent = "", bullet, number, delimiter, spacing = " ", task] = item;
  if (!line.slice(marker.length).trim()) {
    return { text: text.slice(0, lineStart) + text.slice(lineEnd), caret: lineStart };
  }
  const nextMarker = bullet ?? `${Number(number) + 1}${delimiter}`;
  const insert = `\n${indent}${nextMarker}${spacing}${task ? "[ ] " : ""}`;
  return { text: text.slice(0, caret) + insert + text.slice(caret), caret: caret + insert.length };
}

function insideCodeFence(before: string): boolean {
  let open: string | null = null;
  for (const line of before.split("\n")) {
    const fence = CODE_FENCE.exec(line);
    if (!fence) continue;
    const [, marks = "", rest = ""] = fence;
    if (open === null) {
      if (!(marks[0] === "`" && rest.includes("`"))) open = marks;
    } else if (marks[0] === open[0] && marks.length >= open.length && !rest.trim()) {
      open = null;
    }
  }
  return open !== null;
}
