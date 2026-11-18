import { PREVIEW_PART_CHARACTERS } from "./attachment-file-preview";

/** A part of a long text file on the code view: its place in the text and the number of its first line. */
export interface TextPreviewPart {
  start: number;
  end: number;
  firstLine: number;
}

/**
 * The parts of a text for the code view, about `PREVIEW_PART_CHARACTERS` long each. A part ends
 * after a whole line, except a line longer than one part. A text has at least one part.
 */
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
