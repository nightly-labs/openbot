export interface MediaSize {
  width: number;
  height: number;
}

/** Enough for the pictures and videos of the chats that a user opens in one session. */
const REMEMBERED_SIZES_LIMIT = 500;
const rememberedSizes = new Map<string, MediaSize>();

/**
 * The size of each picture and video that loaded in this window, by attachment id. A file from a
 * joined server arrives seconds after its row, and the summary of an attachment has no size. Without
 * this, the box of each file is square again each time its row mounts, as when the chat opens again
 * or the row comes back into view, and the transcript moves when the file arrives.
 */
export function rememberMediaSize(attachmentId: string, size: MediaSize): void {
  if (size.width <= 0 || size.height <= 0) return;
  rememberedSizes.delete(attachmentId);
  rememberedSizes.set(attachmentId, size);
  if (rememberedSizes.size <= REMEMBERED_SIZES_LIMIT) return;
  const oldest = rememberedSizes.keys().next();
  if (!oldest.done) rememberedSizes.delete(oldest.value);
}

export function rememberedMediaSize(attachmentId: string | undefined): MediaSize | null {
  return attachmentId === undefined ? null : (rememberedSizes.get(attachmentId) ?? null);
}
