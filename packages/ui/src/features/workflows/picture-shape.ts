/** Whether a picture on the canvas has clear pixels, so its card can let the canvas show through. */

import { createEffect, createSignal } from "solid-js";

/** The longest side, in pixels, of the copy of a picture that the alpha check reads. */
const ALPHA_SAMPLE = 96;

/** A picture with clear pixels, and its width over its height. */
interface PictureShape {
  clear: boolean;
  ratio: number;
}

/**
 * Reads a small copy of the picture and finds clear pixels. A JPEG has none. A picture that the
 * canvas cannot read, as one from an origin without CORS, counts as opaque, so it keeps its card.
 */
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

/**
 * The shape of the picture at the URL, once it is known; on a failure, none. While the next picture
 * loads, the last shape stays, so the card does not flash between two clear results.
 */
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
