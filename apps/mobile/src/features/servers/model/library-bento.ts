interface BentoTile {
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

type BentoShape = "featureStart" | "wideEnd" | "featureEnd" | "wideStart";
const CYCLE: readonly BentoShape[] = ["featureStart", "wideEnd", "featureEnd", "wideStart"];

export function bentoBlocks(featured: readonly boolean[], width: number, columns: number, gap: number): BentoBlock[] {
  const cell = (width - gap * (columns - 1)) / columns;
  const span = (cells: number) => cells * cell + (cells - 1) * gap;
  const blocks: BentoBlock[] = [];
  let next = 0;

  function take(count: number): number[] {
    const indices = Array.from({ length: count }, (_, offset) => next + offset);
    next += count;
    const lead = indices.find((index) => featured[index]) ?? indices[0];
    return lead === undefined ? [] : [lead, ...indices.filter((index) => index !== lead)];
  }

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
