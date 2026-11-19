import type { ChatPreviewKind } from "@openbot/contracts/chat-preview";

export interface CodePreviewEntry {
  kind: ChatPreviewKind | "markdown" | "text" | "pdf" | "spreadsheet";
  source: string;
  language?: string;
  title?: string;
  file?: { uri: string; name: string; mimeType: string };
}

const ENTRY_LIMIT = 20;
const entries = new Map<string, CodePreviewEntry>();
let entryCount = 0;

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

export function codePreview(id: string | undefined): CodePreviewEntry | undefined {
  return id === undefined ? undefined : entries.get(id);
}
