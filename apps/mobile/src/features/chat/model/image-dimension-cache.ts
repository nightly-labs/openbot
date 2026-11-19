import type { ImageDimensions } from "./image-dimensions";

export interface DimensionStorage {
  read(): string | null;
  write(text: string): void;
}

const LIMIT = 500;
const SAVE_DELAY_MS = 1_000;
const DRAFT_PREFIX = "mobile-draft-attachment-";

function isDimension(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 100_000;
}

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
    } catch {}
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
