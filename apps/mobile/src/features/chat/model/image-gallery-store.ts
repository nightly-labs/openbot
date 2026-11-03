import type { AttachmentSummary } from "@openbot/contracts/ipc";

export interface ImageGalleryEntry {
  serverId: string;
  images: readonly AttachmentSummary[];
}

// A route param cannot carry the attachments, so the chat keeps the gallery here and passes its id.
// The last few are enough: a gallery screen opens from the chat that is on screen.
const ENTRY_LIMIT = 20;
const entries = new Map<string, ImageGalleryEntry>();
let entryCount = 0;

/** Keeps a message's images for the gallery screen and returns the id of its route. */
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

/** The images of a gallery route, or undefined after the app restarted. */
export function imageGallery(id: string | undefined): ImageGalleryEntry | undefined {
  return id === undefined ? undefined : entries.get(id);
}
