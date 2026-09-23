import type { ImageDimensions } from "./image-dimensions";

export interface DimensionStorage {
  read(): string | null;
  write(text: string): void;
}

// The host sends no image size, so an image is only measured once it has downloaded. A size the
// phone has measured before is kept across launches: the chat then reserves the real shape at
// once, and a history image does not resize, and push the messages around it, as it loads.
const LIMIT = 500;
const SAVE_DELAY_MS = 1_000;
// A draft ID names a different file in every composer session, so its size is never saved.
const DRAFT_PREFIX = "mobile-draft-attachment-";

function isDimension(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 100_000;
}

/** The saved entries a later launch can trust, oldest first. Anything else is dropped. */
function decodeSavedSizes(value: unknown): [string, ImageDimensions][] {
  if (!Array.isArray(value)) return [];
  return value.slice(-LIMIT).flatMap((entry): [string, ImageDimensions][] => {
    if (!Array.isArray(entry)) return [];
    const [id, width, height] = entry;
    return typeof id === "string" && id.length <= 200 && isDimension(width) && isDimension(height)
      ? [[id, { width, height }]]
      : [];
  });
}

/**
 * Image sizes by attachment ID, most recent last, with at most 500 kept. It reads its storage on
 * first use and writes it a second after the last change. Storage that fails to read or write
 * only costs the saved sizes, never the chat.
 */
export function createImageDimensionCache(storage: DimensionStorage) {
  const sizes = new Map<string, ImageDimensions>();
  let loaded = false;
  let savePending = false;

  function load() {
    if (loaded) return;
    loaded = true;
    try {
      const text = storage.read();
      for (const [id, size] of text ? decodeSavedSizes(JSON.parse(text)) : []) sizes.set(id, size);
    } catch {
      sizes.clear();
    }
  }

  function save() {
    savePending = false;
    const entries = [...sizes]
      .filter(([id]) => !id.startsWith(DRAFT_PREFIX))
      .map(([id, size]) => [id, size.width, size.height]);
    try {
      storage.write(JSON.stringify(entries));
    } catch {
      // The sizes stay in memory for this launch.
    }
  }

  return {
    get(id: string): ImageDimensions | null {
      load();
      return sizes.get(id) ?? null;
    },
    remember(id: string, size: ImageDimensions) {
      load();
      const known = sizes.get(id);
      if (known?.width === size.width && known.height === size.height) return;
      sizes.delete(id);
      sizes.set(id, size);
      if (sizes.size > LIMIT) {
        const oldest = sizes.keys().next().value;
        if (oldest !== undefined) sizes.delete(oldest);
      }
      if (id.startsWith(DRAFT_PREFIX) || savePending) return;
      savePending = true;
      setTimeout(save, SAVE_DELAY_MS);
    },
  };
}
