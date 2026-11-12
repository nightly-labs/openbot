interface BentoTile {
  /** The place of the file in the list that the blocks lay out. */
  index: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface BentoBlock {
  height: number;
  tiles: BentoTile[];
}

/**
 * The blocks repeat in this order: a large square at the start, a wide tile at the end, a large
 * square at the end, a wide tile at the start. So no two blocks after each other have the same shape.
 */
type BentoShape = "featureStart" | "wideEnd" | "featureEnd" | "wideStart";
const CYCLE: readonly BentoShape[] = ["featureStart", "wideEnd", "featureEnd", "wideStart"];

/**
 * The Library grid as blocks of a bento layout, one list row for each block. A feature block has a
 * square of two by two cells and fills the other cells of its two rows; a wide block has a tile of two
 * cells in one row. The large tile of a block takes its first `featured` file (a picture), so the
 * files keep their order except in their block. The files after the last whole block fill plain rows.
 */
export function bentoBlocks(featured: readonly boolean[], width: number, columns: number, gap: number): BentoBlock[] {
  // Not rounded, so the last column ends at the side room of the title.
  const cell = (width - gap * (columns - 1)) / columns;
  const span = (cells: number) => cells * cell + (cells - 1) * gap;
  const blocks: BentoBlock[] = [];
  let next = 0;

  /** The next `count` files, with the first featured file first. */
  function take(count: number): number[] {
    const indices = Array.from({ length: count }, (_, offset) => next + offset);
    next += count;
    const lead = indices.find((index) => featured[index]) ?? indices[0];
    return lead === undefined ? [] : [lead, ...indices.filter((index) => index !== lead)];
  }

  /** Puts the small tiles in the free cells, row by row. */
  function fill(indices: number[], rows: number, taken: (row: number, column: number) => boolean): BentoTile[] {
    const tiles: BentoTile[] = [];
    for (let row = 0; row < rows; row += 1)
      for (let column = 0; column < columns; column += 1) {
        if (taken(row, column)) continue;
        const index = indices.shift();
        if (index === undefined) return tiles;
        tiles.push({ index, left: column * (cell + gap), top: row * (cell + gap), width: cell, height: cell });
      }
    return tiles;
  }

  while (next < featured.length) {
    const shape = CYCLE[blocks.length % CYCLE.length] ?? "featureStart";
    const feature = shape === "featureStart" || shape === "featureEnd";
    const atStart = shape === "featureStart" || shape === "wideStart";
    const rows = feature ? 2 : 1;
    const capacity = 1 + (columns - 2) * rows;
    const first = atStart ? 0 : columns - 2;
    if (featured.length - next < capacity) {
      const indices = take(Math.min(columns, featured.length - next));
      indices.sort((left, right) => left - right);
      blocks.push({ height: cell, tiles: fill(indices, 1, () => false) });
      continue;
    }
    const [lead, ...rest] = take(capacity);
    if (lead === undefined) break;
    const large = { index: lead, left: first * (cell + gap), top: 0, width: span(2), height: span(rows) };
    const small = fill(rest, rows, (_row, column) => column === first || column === first + 1);
    blocks.push({ height: span(rows), tiles: [large, ...small] });
  }
  return blocks;
}
