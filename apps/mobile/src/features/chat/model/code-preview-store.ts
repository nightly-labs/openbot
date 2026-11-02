import type { ChatPreviewKind } from "@openbot/contracts/chat-preview";

export interface CodePreviewEntry {
  /**
   * A ```html or ```mermaid block from a reply, or a file from the chat: an HTML page, a Markdown
   * file, a text file, a PDF or a spreadsheet. A PDF and a spreadsheet have no `source`; the
   * screen reads their `file`.
   */
  kind: ChatPreviewKind | "markdown" | "text" | "pdf" | "spreadsheet";
  source: string;
  language?: string;
  /** The source is the start of a longer file. */
  truncated?: boolean;
  /** The file the source came from. The screen shows its name and can share it. */
  file?: { uri: string; name: string; mimeType: string };
}

// A route param cannot carry a whole page, so the chat keeps the block here and passes its id. The
// last few blocks are enough: a preview screen opens from the chat that is on screen.
const ENTRY_LIMIT = 20;
const entries = new Map<string, CodePreviewEntry>();
let entryCount = 0;

/** Keeps a block for the preview screen and returns the id of its route. */
export function storeCodePreview(entry: CodePreviewEntry): string {
  entryCount += 1;
  const id = String(entryCount);
  if (entries.size >= ENTRY_LIMIT) {
    const oldest = entries.keys().next();
    if (!oldest.done) entries.delete(oldest.value);
  }
  entries.set(id, entry);
  return id;
}

/** The block of a preview route, or undefined after the app restarted. */
export function codePreview(id: string | undefined): CodePreviewEntry | undefined {
  return id === undefined ? undefined : entries.get(id);
}
