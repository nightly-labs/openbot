export interface ChatMath {
  raw: string;
  tex: string;
  display: boolean;
}

const DISPLAY_DELIMITERS = [
  ["$$", "$$"],
  ["\\[", "\\]"],
] as const;

export function chatMathStart(source: string): number | undefined {
  const index = source.search(/\$|\\[([]/u);
  return index === -1 ? undefined : index;
}

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

export function chatMathBlockStart(source: string): number | undefined {
  const match = /(?:^|\n) {0,3}(?:\$\$|\\\[)/u.exec(source);
  if (!match) return undefined;
  return match[0].startsWith("\n") ? match.index + 1 : match.index;
}

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

export function chatMathBlockInterrupts(source: string, end: number): boolean {
  for (let line = source.indexOf("\n") + 1; line > 0 && line < end; line = source.indexOf("\n", line) + 1) {
    if (blockChatMath(source.slice(line))) return true;
  }
  return false;
}

function delimitedMath(source: string, open: string, close: string, display: boolean): ChatMath | null {
  for (let index = open.length; index < source.length; index += 1) {
    if (source.startsWith("\\\\", index)) {
      index += 1;
      continue;
    }
    if (source.startsWith(close, index)) {
      const tex = source.slice(open.length, index);
      return tex.trim() ? { raw: source.slice(0, index + close.length), tex: tex.trim(), display } : null;
    }
    if (source[index] === "\\" && close.startsWith("$")) index += 1;
  }
  return null;
}
