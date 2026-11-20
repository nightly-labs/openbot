import { onCleanup } from "solid-js";

const MOST_COLUMNS = 4;
const LEAST_TILE_WIDTH = 220;
const TILE_WIDTH = "--library-tile-width";
const TILE_X = "--library-tile-x";
const TILE_Y = "--library-tile-y";
const MOSAIC_HEIGHT = "--library-mosaic-height";

function pixels(value: string): number {
  return Number.parseFloat(value) || 0;
}

function columnCount(width: number, gap: number): number {
  return Math.min(MOST_COLUMNS, Math.max(1, Math.floor((width + gap) / (LEAST_TILE_WIDTH + gap))));
}

function setPixels(element: HTMLElement, name: string, value: number): void {
  const next = `${value}px`;
  if (element.style.getPropertyValue(name) !== next) element.style.setProperty(name, next);
}

function tilesOf(grid: HTMLElement): HTMLElement[] {
  return [...grid.children].filter((child) => child instanceof HTMLElement);
}

function place(grid: HTMLElement): void {
  if (grid.dataset.layout !== "mosaic") return;
  const style = getComputedStyle(grid);
  const columnGap = pixels(style.columnGap);
  const rowGap = pixels(style.rowGap);
  const width = grid.clientWidth;
  const columns = columnCount(width, columnGap);
  const tileWidth = (width - (columns - 1) * columnGap) / columns;
  setPixels(grid, TILE_WIDTH, tileWidth);
  const tiles = tilesOf(grid);
  const heights = tiles.map((tile) => tile.getBoundingClientRect().height);
  const tops = Array.from({ length: columns }, () => 0);
  tiles.forEach((tile, index) => {
    const column = tops.indexOf(Math.min(...tops));
    const top = tops[column] ?? 0;
    setPixels(tile, TILE_X, column * (tileWidth + columnGap));
    setPixels(tile, TILE_Y, top);
    tops[column] = top + (heights[index] ?? 0) + rowGap;
  });
  setPixels(grid, MOSAIC_HEIGHT, Math.max(0, Math.max(...tops) - rowGap));
}

export function createLibraryMosaic() {
  let grid: HTMLElement | undefined;
  const placeGrid = () => {
    if (grid) place(grid);
  };
  const sized = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(placeGrid);
  const changed =
    typeof MutationObserver === "undefined"
      ? undefined
      : new MutationObserver((records) => {
          for (const record of records) {
            for (const node of record.removedNodes) if (node instanceof HTMLElement) sized?.unobserve(node);
            for (const node of record.addedNodes) if (node instanceof HTMLElement) sized?.observe(node);
          }
          placeGrid();
        });
  onCleanup(() => {
    sized?.disconnect();
    changed?.disconnect();
  });
  return {
    attach(element: HTMLElement): void {
      if (grid === element) return;
      sized?.disconnect();
      changed?.disconnect();
      grid = element;
      sized?.observe(element);
      for (const tile of tilesOf(element)) sized?.observe(tile);
      changed?.observe(element, { childList: true, attributes: true, attributeFilter: ["data-layout"] });
    },
  };
}
