import { onCleanup } from "solid-js";

const TILE_ROWS = "--library-tile-rows";

function tileGap(tile: Element): number {
  return Number.parseFloat(getComputedStyle(tile).marginBottom) || 0;
}

export function createLibraryMosaic() {
  const sized =
    typeof ResizeObserver === "undefined"
      ? undefined
      : new ResizeObserver((entries) => {
          const first = entries[0];
          if (!first) return;
          const gap = tileGap(first.target);
          for (const entry of entries) {
            if (!(entry.target instanceof HTMLElement)) continue;
            const height = entry.borderBoxSize[0]?.blockSize ?? entry.target.offsetHeight;
            entry.target.style.setProperty(TILE_ROWS, String(Math.max(1, Math.ceil(height + gap))));
          }
        });
  onCleanup(() => sized?.disconnect());

  return {
    track(tile: HTMLElement): void {
      sized?.observe(tile);
    },
    forget(tile: HTMLElement): void {
      sized?.unobserve(tile);
    },
  };
}
