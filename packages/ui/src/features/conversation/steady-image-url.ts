import { createEffect, createMemo, createSignal } from "solid-js";

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
