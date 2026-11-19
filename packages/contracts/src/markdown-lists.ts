export interface MarkdownListEdit {
  text: string;
  caret: number;
  replacements?: MarkdownListReplacement[];
}

export interface MarkdownListReplacement {
  start: number;
  end: number;
  text: string;
}

const LIST_ITEM = /^([ \t]*)(?:([-*+])|(\d{1,9})([.)]))([ \t]+)(\[[ xX]\][ \t]+)?/u;
const THEMATIC_BREAK = /^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/u;
const CODE_FENCE = /^([ \t]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)?)(`{3,}|~{3,})(.*)$/u;

function renumberFollowingItems(
  text: string,
  lineEnd: number,
  indent: string,
  number: number,
  delimiter: string,
): { text: string; replacements: MarkdownListReplacement[] } {
  const lines = text.slice(lineEnd).split("\n");
  const replacements: MarkdownListReplacement[] = [];
  let lineStart = lineEnd + 1;
  let expected = number + 1;
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined) break;
    if (!line.trim() || line.length - line.trimStart().length > indent.length) {
      lineStart += line.length + 1;
      continue;
    }
    const item = LIST_ITEM.exec(line);
    const [, itemIndent = "", bullet, itemNumber, itemDelimiter] = item ?? [];
    if (
      bullet ||
      itemIndent !== indent ||
      itemDelimiter !== delimiter ||
      itemNumber === undefined ||
      Number(itemNumber) !== expected
    )
      break;
    const start = lineStart + indent.length;
    replacements.push({ start, end: start + itemNumber.length, text: String(expected + 1) });
    lines[index] = `${line.slice(0, indent.length)}${expected + 1}${line.slice(indent.length + itemNumber.length)}`;
    lineStart += line.length + 1;
    expected += 1;
  }
  return { text: text.slice(0, lineEnd) + lines.join("\n"), replacements };
}

export function markdownListLineBreak(text: string, caret: number): MarkdownListEdit | null {
  const lineStart = text.lastIndexOf("\n", caret - 1) + 1;
  const nextBreak = text.indexOf("\n", caret);
  const lineEnd = nextBreak === -1 ? text.length : nextBreak;
  const line = text.slice(lineStart, lineEnd);
  if (THEMATIC_BREAK.test(line) || insideCodeFence(text.slice(0, lineEnd))) return null;
  const item = LIST_ITEM.exec(line);
  if (!item || lineStart + item[0].length > caret) return null;

  const [marker, indent = "", bullet, number, delimiter, spacing = " ", task] = item;
  if (!line.slice(marker.length).trim()) {
    return { text: text.slice(0, lineStart) + text.slice(lineEnd), caret: lineStart };
  }
  const currentNumber = number === undefined ? null : Number(number);
  const nextMarker = bullet ?? `${(currentNumber ?? 0) + 1}${delimiter}`;
  const insert = `\n${indent}${nextMarker}${spacing}${task ? "[ ] " : ""}`;
  const renumbered =
    currentNumber === null || delimiter === undefined
      ? { text, replacements: [] }
      : renumberFollowingItems(text, lineEnd, indent, currentNumber, delimiter);
  return {
    text: renumbered.text.slice(0, caret) + insert + renumbered.text.slice(caret),
    caret: caret + insert.length,
    ...(renumbered.replacements.length > 0 ? { replacements: renumbered.replacements } : {}),
  };
}

function insideCodeFence(lines: string): boolean {
  let open: { marks: string; itemIndent: number } | null = null;
  let itemIndent: number | null = null;
  for (const line of lines.split("\n")) {
    const indent = line.length - line.trimStart().length;
    if (open && open.itemIndent > 0 && line.trim() && indent < open.itemIndent) open = null;
    const fence = CODE_FENCE.exec(line);
    if (!open) {
      const item = LIST_ITEM.exec(line);
      if (item) itemIndent = item[0].length - (item[6]?.length ?? 0);
      else if (line.trim() && itemIndent !== null && indent < itemIndent) itemIndent = null;
    }
    if (!fence) continue;
    const [, lead = "", marks = "", rest = ""] = fence;
    if (open === null) {
      if (marks[0] === "`" && rest.includes("`")) continue;
      const onItemLine = lead.length > indent ? lead.length : null;
      open = { marks, itemIndent: onItemLine ?? (itemIndent !== null && indent >= itemIndent ? itemIndent : 0) };
    } else if (
      lead.length === indent &&
      marks[0] === open.marks[0] &&
      marks.length >= open.marks.length &&
      !rest.trim()
    ) {
      open = null;
    }
  }
  return open !== null;
}
