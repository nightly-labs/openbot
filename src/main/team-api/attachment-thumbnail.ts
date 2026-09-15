// Only resolved managed attachment paths enter this cache. Native thumbnail generation
// runs asynchronously; one job at a time bounds decoder memory for attachment-heavy queues.
export function createAttachmentThumbnailCache(render: (path: string) => Promise<Buffer>) {
  const cache = new Map<string, Promise<Buffer>>();
  let pending: Promise<void> = Promise.resolve();
  return (path: string): Promise<Buffer> => {
    const cached = cache.get(path);
    if (cached) return cached;
    const result = pending.then(() => render(path));
    pending = result.then(
      () => {},
      () => {},
    );
    cache.set(path, result);
    while (cache.size > 64) {
      const oldest = cache.keys().next().value;
      if (oldest) cache.delete(oldest);
    }
    void result.catch(() => cache.delete(path));
    return result;
  };
}
export const attachmentThumbnail = createAttachmentThumbnailCache(async (path) => {
  const { nativeImage } = await import("electron");
  const image = await nativeImage.createThumbnailFromPath(path, { width: 64, height: 64 });
  if (image.isEmpty()) throw new Error("A thumbnail is unavailable for this file.");
  const size = image.getSize();
  const thumbnail = size.height > 64 ? image.resize({ height: 64 }) : image;
  const bytes = thumbnail.toPNG();
  if (bytes.length > 64_000) throw new Error("The thumbnail exceeds the preview limit.");
  return bytes;
});
