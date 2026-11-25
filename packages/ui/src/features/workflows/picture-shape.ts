import { createEffect, createSignal } from "solid-js";

const ALPHA_SAMPLE = 96;

interface PictureShape {
  clear: boolean;
  ratio: number;
}

const CACHE_LIMIT = 128;
const shapeCache = new Map<string, Promise<PictureShape | undefined>>();

async function blobShape(blob: Blob): Promise<PictureShape | undefined> {
  if (blob.type === "image/jpeg") return undefined;
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, ALPHA_SAMPLE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const context = new OffscreenCanvas(width, height).getContext("2d", { willReadFrequently: true });
    if (!context) return undefined;
    context.drawImage(bitmap, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height).data;
    let clear = false;
    for (let index = 3; index < pixels.length; index += 4) {
      if ((pixels[index] ?? 255) < 250) {
        clear = true;
        break;
      }
    }
    return { clear, ratio: bitmap.width / bitmap.height };
  } finally {
    bitmap.close();
  }
}

function cachedPictureShape(url: string): Promise<PictureShape | undefined> {
  const known = shapeCache.get(url);
  if (known) {
    shapeCache.delete(url);
    shapeCache.set(url, known);
    return known;
  }
  const forget = () => {
    if (shapeCache.get(url) === pending) shapeCache.delete(url);
  };
  const pending = fetch(url).then(async (response) => {
    if (!response.ok) {
      forget();
      return undefined;
    }
    return blobShape(await response.blob());
  });
  pending.catch(forget);
  shapeCache.set(url, pending);
  if (shapeCache.size > CACHE_LIMIT) {
    const oldest = shapeCache.keys().next().value;
    if (oldest !== undefined) shapeCache.delete(oldest);
  }
  return pending;
}

export function usePictureShape(url: () => string | undefined) {
  const [shape, setShape] = createSignal<PictureShape>();
  createEffect(url, (current) => {
    if (!current) {
      setShape(undefined);
      return;
    }
    let live = true;
    cachedPictureShape(current).then(
      (next) => {
        if (live) setShape(next);
      },
      () => {
        if (live) setShape(undefined);
      },
    );
    return () => {
      live = false;
    };
  });
  return shape;
}
