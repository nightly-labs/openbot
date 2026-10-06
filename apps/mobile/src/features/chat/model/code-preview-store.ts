import type { ChatPreviewKind } from "@openbot/contracts/chat-preview";

export interface CodePreviewEntry {
  kind: ChatPreviewKind;
  source: string;
  language?: string;
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
