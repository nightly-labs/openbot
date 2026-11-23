export interface MediaSize {
  width: number;
  height: number;
}

const REMEMBERED_SIZES_LIMIT = 500;
const rememberedSizes = new Map<string, MediaSize>();

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
