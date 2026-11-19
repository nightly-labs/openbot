import { createEffect, createSignal } from "solid-js";

const ALPHA_SAMPLE = 96;

interface PictureShape {
  clear: boolean;
  ratio: number;
}

async function pictureShape(url: string): Promise<PictureShape | undefined> {
  const response = await fetch(url);
  if (!response.ok) return undefined;
  const blob = await response.blob();
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

export function usePictureShape(url: () => string | undefined) {
  const [shape, setShape] = createSignal<PictureShape>();
  createEffect(url, (current) => {
    if (!current) {
      setShape(undefined);
      return;
    }
    let live = true;
    pictureShape(current).then(
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
