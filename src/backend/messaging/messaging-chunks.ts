export const FENCE = "```";

/**
 * Splits markdown into posts of at most `limit` characters, at line ends where it can. A code block
 * that a split cuts is closed at the end of one post and opened again at the start of the next.
 */
export function chunkMarkdown(text: string, limit: number): string[] {
  const reserve = FENCE.length + 1;
  const chunks: string[] = [];
  let current = "";
  let inFence = false;
  const flush = () => {
    if (!current.trim()) return;
    chunks.push(inFence ? `${current}\n${FENCE}` : current);
    current = inFence ? FENCE : "";
  };
  for (const line of text.split("\n")) {
    const pieces = line.length > limit - reserve * 2 ? hardSplit(line, limit - reserve * 2) : [line];
    for (const piece of pieces) {
      const next = current ? `${current}\n${piece}` : piece;
      if (next.length + (inFence ? reserve : 0) > limit) {
        flush();
        current = current ? `${current}\n${piece}` : piece;
      } else current = next;
    }
    if (line.trimStart().startsWith(FENCE)) inFence = !inFence;
  }
  if (current.trim() && current !== FENCE) chunks.push(current);
  return chunks.length ? chunks : [""];
}

function hardSplit(line: string, size: number): string[] {
  const parts: string[] = [];
  for (let index = 0; index < line.length; index += size) parts.push(line.slice(index, index + size));
  return parts;
}
