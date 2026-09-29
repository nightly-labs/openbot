/**
 * The LaTeX delimiters that desktop, web and mobile read in a message, so each app typesets the
 * same text. Inline math is `$...$` or `\(...\)`; display math is `$$...$$` or `\[...\]`.
 *
 * A single `$` opens math only before a character that is not a space, and closes it only after a
 * character that is not a space and before a character that is not a digit. So "costs $5 and $10"
 * stays text.
 */
export interface ChatMath {
  /** The source that the math replaces, delimiters included. */
  raw: string;
  /** The LaTeX between the delimiters. */
  tex: string;
  display: boolean;
}

const DISPLAY_DELIMITERS = [
  ["$$", "$$"],
  ["\\[", "\\]"],
] as const;

/** The first index in `source` where inline math can start, if any. */
export function chatMathStart(source: string): number | undefined {
  const index = source.search(/\$|\\[([]/u);
  return index === -1 ? undefined : index;
}

/** The math at the start of `source`, inside a line of text. */
export function inlineChatMath(source: string): ChatMath | null {
  for (const [open, close] of DISPLAY_DELIMITERS) {
    if (source.startsWith(open)) return delimitedMath(source, open, close, true);
  }
  if (source.startsWith("\\(")) return delimitedMath(source, "\\(", "\\)", false);
  if (!source.startsWith("$")) return null;
  const first = source[1];
  if (first === undefined || /\s/u.test(first)) return null;
  for (let index = 1; index < source.length; index += 1) {
    const character = source[index];
    if (character === "\\") {
      index += 1;
      continue;
    }
    if (character === "\n" && source[index + 1] === "\n") return null;
    if (character !== "$") continue;
    const before = source[index - 1] ?? "";
    const after = source[index + 1] ?? "";
    if (/\s/u.test(before) || /\d/u.test(after)) return null;
    return { raw: source.slice(0, index + 1), tex: source.slice(1, index), display: false };
  }
  return null;
}

/** The first index in `source` where a display math block can start at the start of a line. */
export function chatMathBlockStart(source: string): number | undefined {
  const match = /(?:^|\n) {0,3}(?:\$\$|\\\[)/u.exec(source);
  if (!match) return undefined;
  return match[0].startsWith("\n") ? match.index + 1 : match.index;
}

/**
 * A display math block at the start of `source`: `$$` or `\[` at the start of a line, and the
 * closing delimiter at the end of a line.
 */
export function blockChatMath(source: string): ChatMath | null {
  const indent = /^ {0,3}/u.exec(source)?.[0].length ?? 0;
  const rest = source.slice(indent);
  for (const [open, close] of DISPLAY_DELIMITERS) {
    if (!rest.startsWith(open)) continue;
    const math = delimitedMath(rest, open, close, true);
    if (!math) return null;
    const lineEnd = /^[\t ]*(?:\n+|$)/u.exec(rest.slice(math.raw.length));
    if (!lineEnd) return null;
    return { ...math, raw: source.slice(0, indent + math.raw.length + lineEnd[0].length) };
  }
  return null;
}

function delimitedMath(source: string, open: string, close: string, display: boolean): ChatMath | null {
  for (let index = open.length; index < source.length; index += 1) {
    if (source.startsWith(close, index)) {
      const tex = source.slice(open.length, index);
      return tex.trim() ? { raw: source.slice(0, index + close.length), tex: tex.trim(), display } : null;
    }
    // `\\` is a LaTeX line break and `\$` a dollar sign, not the start of a delimiter.
    if (source[index] === "\\" && close.startsWith("$")) index += 1;
  }
  return null;
}
