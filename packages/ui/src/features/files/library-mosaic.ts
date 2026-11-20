import { onCleanup } from "solid-js";

const TILE_ROWS = "--library-tile-rows";

function fitTile(tile: HTMLElement, height: number): void {
  const gap = Number.parseFloat(getComputedStyle(tile).marginBottom) || 0;
  tile.style.setProperty(TILE_ROWS, String(Math.max(1, Math.ceil(height + gap))));
}

export function createLibraryMosaic() {
  const sized =
    typeof ResizeObserver === "undefined"
      ? undefined
      : new ResizeObserver((entries) => {
          for (const entry of entries) {
            if (!(entry.target instanceof HTMLElement)) continue;
            fitTile(entry.target, entry.borderBoxSize[0]?.blockSize ?? entry.target.offsetHeight);
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
