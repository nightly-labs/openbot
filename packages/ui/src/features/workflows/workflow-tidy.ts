import type { WfnPoint } from "./workflow-board";
import type { Box } from "./workflow-ink";

export interface TidyUnit {
  id: string;
  box: Box;
}

export interface TidyLink {
  from: string;
  to: string;
}

const COLUMN_GAP = 96;
const ROW_GAP = 48;
const PART_GAP = 96;
const LOOSE_ROW_WIDTH = 1200;
const SWEEPS = 4;

interface Part {
  ids: readonly string[];
  links: readonly TidyLink[];
}

interface Placed {
  at: Map<string, WfnPoint>;
  width: number;
  height: number;
}

const centerY = (box: Box) => box.y + box.height / 2;
const mean = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

function splitParts(units: readonly TidyUnit[], links: readonly TidyLink[]): Part[] {
  const root = new Map(units.map((unit) => [unit.id, unit.id]));
  const find = (id: string): string => {
    let at = id;
    while (root.get(at) !== at) at = root.get(at) ?? at;
    root.set(id, at);
    return at;
  };
  for (const link of links) root.set(find(link.from), find(link.to));
  const parts = new Map<string, { ids: string[]; links: TidyLink[] }>();
  for (const unit of units) {
    const key = find(unit.id);
    const part = parts.get(key) ?? { ids: [], links: [] };
    part.ids.push(unit.id);
    parts.set(key, part);
  }
  for (const link of links) parts.get(find(link.from))?.links.push(link);
  return [...parts.values()];
}

function acyclic(ids: readonly string[], links: readonly TidyLink[], boxes: ReadonlyMap<string, Box>): TidyLink[] {
  const next = new Map<string, TidyLink[]>(ids.map((id) => [id, []]));
  const entering = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const link of links) {
    next.get(link.from)?.push(link);
    entering.set(link.to, (entering.get(link.to) ?? 0) + 1);
  }
  const left = (id: string) => boxes.get(id)?.x ?? 0;
  const starts = [...ids].sort(
    (one, other) => (entering.get(one) ?? 0) - (entering.get(other) ?? 0) || left(one) - left(other),
  );
  const state = new Map<string, "open" | "done">();
  const kept: TidyLink[] = [];
  for (const start of starts) {
    if (state.has(start)) continue;
    const stack: { id: string; index: number }[] = [{ id: start, index: 0 }];
    state.set(start, "open");
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      if (!top) break;
      const link = next.get(top.id)?.[top.index];
      if (!link) {
        state.set(top.id, "done");
        stack.pop();
        continue;
      }
      top.index += 1;
      const seen = state.get(link.to);
      if (seen === "open") continue;
      kept.push(link);
      if (seen === undefined) {
        state.set(link.to, "open");
        stack.push({ id: link.to, index: 0 });
      }
    }
  }
  return kept;
}

function columnsOf(ids: readonly string[], links: readonly TidyLink[]): Map<string, number> {
  const before = new Map<string, string[]>(ids.map((id) => [id, []]));
  const after = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const link of links) {
    before.get(link.to)?.push(link.from);
    after.get(link.from)?.push(link.to);
  }
  const waiting = new Map(ids.map((id) => [id, before.get(id)?.length ?? 0]));
  const order: string[] = ids.filter((id) => waiting.get(id) === 0);
  for (let index = 0; index < order.length; index++) {
    const id = order[index];
    if (id === undefined) continue;
    for (const to of after.get(id) ?? []) {
      const count = (waiting.get(to) ?? 0) - 1;
      waiting.set(to, count);
      if (count === 0) order.push(to);
    }
  }
  const column = new Map<string, number>();
  for (const id of order)
    column.set(id, Math.max(0, ...(before.get(id) ?? []).map((from) => (column.get(from) ?? 0) + 1)));
  for (const id of [...order].reverse()) {
    const targets = after.get(id) ?? [];
    if ((before.get(id) ?? []).length > 0 || targets.length === 0) continue;
    column.set(id, Math.min(...targets.map((to) => column.get(to) ?? 1)) - 1);
  }
  return column;
}

function orderColumns(
  column: ReadonlyMap<string, number>,
  links: readonly TidyLink[],
  boxes: ReadonlyMap<string, Box>,
): string[][] {
  const count = Math.max(0, ...column.values()) + 1;
  const columns: string[][] = Array.from({ length: count }, () => []);
  for (const [id, index] of column) columns[index]?.push(id);
  const y = (id: string) => {
    const box = boxes.get(id);
    return box ? centerY(box) : 0;
  };
  for (const list of columns) list.sort((one, other) => y(one) - y(other));
  const rank = new Map<string, number>();
  const rerank = () => {
    for (const list of columns) for (const [index, id] of list.entries()) rank.set(id, index);
  };
  const neighbours = (id: string, side: "before" | "after") =>
    links.flatMap((link) =>
      side === "before" ? (link.to === id ? [link.from] : []) : link.from === id ? [link.to] : [],
    );
  const sweep = (list: string[], side: "before" | "after") => {
    const key = new Map(
      list.map((id) => {
        const near = neighbours(id, side).flatMap((other) => rank.get(other) ?? []);
        return [id, near.length > 0 ? mean(near) : (rank.get(id) ?? 0)];
      }),
    );
    list.sort((one, other) => (key.get(one) ?? 0) - (key.get(other) ?? 0));
  };
  rerank();
  for (let round = 0; round < SWEEPS; round++) {
    for (const list of columns.slice(1)) {
      sweep(list, "before");
      rerank();
    }
    for (const list of columns.slice(0, -1).reverse()) {
      sweep(list, "after");
      rerank();
    }
  }
  return columns;
}

function placePart(part: Part, boxes: ReadonlyMap<string, Box>): Placed {
  const links = acyclic(part.ids, part.links, boxes);
  const columns = orderColumns(columnsOf(part.ids, links), links, boxes);
  const size = (id: string) => boxes.get(id) ?? { x: 0, y: 0, width: 0, height: 0 };
  const placed = new Map<string, Box>();
  let x = 0;
  for (const list of columns) {
    const desired = list.map((id) => {
      const from = links.flatMap((link) => (link.to === id ? (placed.get(link.from) ?? []) : []));
      return from.length > 0 ? mean(from.map(centerY)) : undefined;
    });
    const tops: number[] = [];
    let floor = Number.NEGATIVE_INFINITY;
    list.forEach((id, index) => {
      const { height } = size(id);
      const wish = desired[index];
      const top = Math.max(floor, wish === undefined ? (Number.isFinite(floor) ? floor : 0) : wish - height / 2);
      tops.push(top);
      floor = top + height + ROW_GAP;
    });
    const drift = list.flatMap((id, index) => {
      const wish = desired[index];
      const top = tops[index];
      return wish === undefined || top === undefined ? [] : [top + size(id).height / 2 - wish];
    });
    const lift = drift.length > 0 ? mean(drift) : 0;
    list.forEach((id, index) => {
      const { width, height } = size(id);
      placed.set(id, { x, y: (tops[index] ?? 0) - lift, width, height });
    });
    x += Math.max(0, ...list.map((id) => size(id).width)) + COLUMN_GAP;
  }
  return normalise(placed);
}

function placeLoose(ids: readonly string[], boxes: ReadonlyMap<string, Box>, rowWidth: number): Placed {
  const placed = new Map<string, Box>();
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  for (const id of ids) {
    const box = boxes.get(id);
    if (!box) continue;
    if (x > 0 && x + box.width > rowWidth) {
      x = 0;
      y += rowHeight + ROW_GAP;
      rowHeight = 0;
    }
    placed.set(id, { x, y, width: box.width, height: box.height });
    x += box.width + COLUMN_GAP;
    rowHeight = Math.max(rowHeight, box.height);
  }
  return normalise(placed);
}

function normalise(placed: ReadonlyMap<string, Box>): Placed {
  const boxes = [...placed.values()];
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return {
    at: new Map([...placed].map(([id, box]) => [id, { x: box.x - left, y: box.y - top }])),
    width: right - left,
    height: bottom - top,
  };
}

export function tidyLayout(units: readonly TidyUnit[], links: readonly TidyLink[]): Map<string, WfnPoint> {
  if (units.length === 0) return new Map();
  const boxes = new Map(units.map((unit) => [unit.id, unit.box]));
  const unique = new Map<string, TidyLink>();
  for (const link of links)
    if (link.from !== link.to && boxes.has(link.from) && boxes.has(link.to))
      unique.set(`${link.from}\u0000${link.to}`, { from: link.from, to: link.to });
  const parts = splitParts(units, [...unique.values()]);
  const top = (part: Part) => Math.min(...part.ids.map((id) => boxes.get(id)?.y ?? 0));
  const left = (part: Part) => Math.min(...part.ids.map((id) => boxes.get(id)?.x ?? 0));
  const flows = parts
    .filter((part) => part.ids.length > 1)
    .sort((one, other) => top(one) - top(other) || left(one) - left(other))
    .map((part) => placePart(part, boxes));
  const loose = parts
    .filter((part) => part.ids.length === 1)
    .sort((one, other) => top(one) - top(other) || left(one) - left(other))
    .flatMap((part) => part.ids);
  const rowWidth = Math.max(LOOSE_ROW_WIDTH, ...flows.map((flow) => flow.width));
  const blocks = loose.length > 0 ? [...flows, placeLoose(loose, boxes, rowWidth)] : flows;
  const origin = {
    x: Math.min(...units.map((unit) => unit.box.x)),
    y: Math.min(...units.map((unit) => unit.box.y)),
  };
  const result = new Map<string, WfnPoint>();
  let y = origin.y;
  for (const block of blocks) {
    for (const [id, at] of block.at) result.set(id, { x: origin.x + at.x, y: y + at.y });
    y += block.height + PART_GAP;
  }
  return result;
}
