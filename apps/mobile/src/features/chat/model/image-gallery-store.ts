import type { AttachmentSummary } from "@openbot/contracts/ipc";

export interface ImageGalleryEntry {
  serverId: string;
  images: readonly AttachmentSummary[];
}

const ENTRY_LIMIT = 20;
const entries = new Map<string, ImageGalleryEntry>();
let entryCount = 0;

export function storeImageGallery(entry: ImageGalleryEntry): string {
  entryCount += 1;
  const id = String(entryCount);
  if (entries.size >= ENTRY_LIMIT) {
    const oldest = entries.keys().next();
    if (!oldest.done) entries.delete(oldest.value);
  }
  entries.set(id, entry);
  return id;
}

export function imageGallery(id: string | undefined): ImageGalleryEntry | undefined {
  return id === undefined ? undefined : entries.get(id);
}
