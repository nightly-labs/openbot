import { createEffect, createMemo, createSignal } from "solid-js";

/**
 * The URL that an `<img>` shows. A new URL replaces a drawn one only after it loads and decodes:
 * Chromium clears an image when its `src` changes, and the box stays empty until the new file
 * loads. A sent image gets the URL of its stored copy, and it keeps its pixels this way.
 */
export function createSteadyImageUrl(url: () => string | null | undefined): () => string | null {
  const [decoded, setDecoded] = createSignal<string | null>(null);
  const shown = createMemo<string | null>((previous = null) => {
    const next = url() ?? null;
    return previous && next && next !== previous && next !== decoded() ? previous : next;
  });
  createEffect(
    () => {
      const next = url() ?? null;
      return next !== shown() ? next : null;
    },
    (next) => {
      if (!next) return;
      const image = new Image();
      let done = false;
      image.src = next;
      // A URL that does not decode is shown too, so that the `<img>` reports the error.
      void image
        .decode()
        .catch(() => undefined)
        .then(() => {
          if (done) return;
          done = true;
          setDecoded(next);
        });
      return () => {
        if (done) return;
        done = true;
        image.src = "";
      };
    },
  );
  return shown;
}
