export interface ImageGalleryLayoutOptions {
  width: number;
  /** A row closes as soon as it fills the width at this height or lower. */
  rowHeight: number;
  /** The last row does not fill the width, so it grows to this height at most. */
  maxRowHeight: number;
  gap: number;
  /** The last row takes images from the row above until it holds this many. */
  minPerRow: number;
}

export interface ImageGalleryTileBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ImageGalleryLayout {
  boxes: ImageGalleryTileBox[];
  height: number;
}

/** Justified rows: each row but the last fills the width, and images keep their aspect ratio. */
export function justifiedGalleryLayout(
  ratios: readonly number[],
  options: ImageGalleryLayoutOptions,
): ImageGalleryLayout {
  if (options.width <= 0 || ratios.length === 0) return { boxes: [], height: 0 };
  const fullHeight = (row: readonly number[]) =>
    (options.width - options.gap * (row.length - 1)) / row.reduce((sum, index) => sum + (ratios[index] ?? 1), 0);

  const rows: number[][] = [];
  let open: number[] = [];
  for (const index of ratios.keys()) {
    open.push(index);
    if (fullHeight(open) <= options.rowHeight) {
      rows.push(open);
      open = [];
    }
  }
  const lastIsOpen = open.length > 0;
  if (lastIsOpen) rows.push(open);

  const last = rows.at(-1);
  const previous = rows.at(-2);
  while (last && previous && last.length < options.minPerRow && previous.length > options.minPerRow) {
    const moved = previous.pop();
    if (moved === undefined) break;
    last.unshift(moved);
  }

  const boxes: ImageGalleryTileBox[] = [];
  let top = 0;
  for (const [rowIndex, row] of rows.entries()) {
    const justified = rowIndex < rows.length - 1 || !lastIsOpen;
    const height = justified ? fullHeight(row) : Math.min(fullHeight(row), options.maxRowHeight);
    let left = 0;
    for (const [position, index] of row.entries()) {
      const fills = justified && position === row.length - 1;
      const width = fills ? options.width - left : (ratios[index] ?? 1) * height;
      boxes[index] = {
        left: Math.round(left),
        top: Math.round(top),
        width: Math.round(width),
        height: Math.round(height),
      };
      left += width + options.gap;
    }
    top += height + options.gap;
  }
  return { boxes, height: Math.round(top - options.gap) };
}
