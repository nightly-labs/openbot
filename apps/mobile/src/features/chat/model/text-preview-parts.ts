import { PREVIEW_PART_CHARACTERS } from "./attachment-file-preview";

export interface TextPreviewPart {
  start: number;
  end: number;
  firstLine: number;
}

export function textPreviewParts(text: string): TextPreviewPart[] {
  const parts: TextPreviewPart[] = [];
  let start = 0;
  let line = 1;
  do {
    let end = Math.min(text.length, start + PREVIEW_PART_CHARACTERS);
    if (end < text.length) {
      const lineEnd = text.lastIndexOf("\n", end - 1);
      if (lineEnd >= start) end = lineEnd + 1;
    }
    parts.push({ start, end, firstLine: line });
    for (let index = text.indexOf("\n", start); index !== -1 && index < end; index = text.indexOf("\n", index + 1))
      line += 1;
    start = end;
  } while (start < text.length);
  return parts;
}
