import {
  defaultRangeExtractor,
  elementScroll,
  measureElement as measureRowElement,
  observeElementOffset,
  observeElementRect,
  type Range,
  type VirtualItem,
  Virtualizer,
} from "@tanstack/virtual-core";
import { createEffect, createMemo, createSignal, createStore, flush, onCleanup, onSettled, untrack } from "solid-js";

interface ChatVirtualizerOptions<TScrollElement extends Element, TItemElement extends Element> {
  count: () => number;
  getScrollElement: () => TScrollElement | null;
  estimateSize: (index: number) => number;
  getItemKey: (index: number) => string | number;
  keyVersion: () => unknown;
  scrollMargin: () => number;
  keptIndexes?: () => readonly number[];
  stickToLatest?: () => boolean;
  followLatest?: (element: TScrollElement) => void;
  onChange?: (virtualizer: Virtualizer<TScrollElement, TItemElement>) => void;
  drawLatestFirst?: () => boolean;
  onRowsDrawn?: (element: TScrollElement) => void;
}

export interface ChatVirtualizer<TItemElement extends Element> {
  getVirtualItems: () => VirtualItem[];
  getTotalSize: () => number;
  isVirtualized: () => boolean;
  measureElement: (element: TItemElement | null) => void;
  scrollMargin: () => number;
  itemStart: (index: number) => number | undefined;
  scrollToIndex: (index: number, options?: { smooth?: boolean }) => void;
  scrollToOffset: (offset: number) => void;
  firstDrawnIndex: () => number;
  drawAllRows: () => void;
}

const STATIC_CHAT_LIMIT = 100;
const STATIC_CHAT_RETURN = 10;
const LATEST_ROWS_FIRST = 10;
const EARLIER_ROWS_PER_FRAME = 5;
const SCROLL_END_THRESHOLD = 80;

export function createChatVirtualizer<TScrollElement extends Element, TItemElement extends Element>(
  options: ChatVirtualizerOptions<TScrollElement, TItemElement>,
): ChatVirtualizer<TItemElement> {
  const initialCount = untrack(options.count);
  const drawsLatestFirst = (): boolean => untrack(() => options.drawLatestFirst?.() === true);
  const latestRowsStart = (count: number): number => Math.max(0, count - LATEST_ROWS_FIRST);
  let drawFrom = initialCount > STATIC_CHAT_LIMIT || !drawsLatestFirst() ? 0 : latestRowsStart(initialCount);
  let drawFrame: number | undefined;
  const [virtualItems, setVirtualItems] = createSignal<VirtualItem[]>(
    untrack(() =>
      fallbackItems(
        initialCount,
        fallbackStart(initialCount, drawFrom),
        options.estimateSize,
        options.getItemKey,
        options.scrollMargin(),
      ),
    ),
  );
  const [totalSize, setTotalSize] = createSignal(initialCount * options.estimateSize(0));
  const stableItems = new Map<VirtualItem["key"], { item: VirtualItem; update: (next: VirtualItem) => void }>();
  const syncScrollEndThreshold = (instance: Virtualizer<TScrollElement, TItemElement>): void => {
    instance.options.scrollEndThreshold = options.stickToLatest?.() === false ? -1 : SCROLL_END_THRESHOLD;
  };
  const virtualizer = new Virtualizer<TScrollElement, TItemElement>({
    count: 0,
    getScrollElement: options.getScrollElement,
    estimateSize: options.estimateSize,
    getItemKey: options.getItemKey,
    observeElementRect,
    observeElementOffset,
    measureElement: (element, entry, instance) => {
      syncScrollEndThreshold(instance);
      if (!entry) {
        const index = instance.indexFromElement(element);
        return (
          instance.itemSizeCache.get(instance.options.getItemKey(index)) ??
          instance.measurementsCache[index]?.size ??
          instance.options.estimateSize(index)
        );
      }
      return measureRowElement(element, entry, instance);
    },
    scrollToFn: (offset, scroll, instance) => {
      const element = instance.scrollElement;
      if (element && scroll.adjustments !== undefined && options.stickToLatest?.()) {
        if (options.followLatest) {
          options.followLatest(element);
          return;
        }
        elementScroll(element.scrollHeight - element.clientHeight, { ...scroll, adjustments: 0 }, instance);
        return;
      }
      elementScroll(offset, scroll, instance);
    },
    overscan: 5,
    anchorTo: "end",
    followOnAppend: "auto",
    scrollEndThreshold: SCROLL_END_THRESHOLD,
    initialRect: { width: 1, height: 600 },
  });
  const virtualized = createMemo((previous?: boolean) => {
    const count = options.count();
    return previous ? count > STATIC_CHAT_LIMIT - STATIC_CHAT_RETURN : count > STATIC_CHAT_LIMIT;
  });
  let refreshQueued = false;
  let disposed = false;

  const stopDrawingEarlierRows = (): void => {
    if (drawFrame !== undefined) cancelAnimationFrame(drawFrame);
    drawFrame = undefined;
    drawFrom = 0;
  };

  const unmeasuredRows = new Set<TItemElement>();
  let measureQueued = false;

  const pruneDisconnectedElements = (): void => {
    if (virtualizer.elementsCache.size > 0) virtualizer.measureElement(null);
  };

  const measureNewRows = (): void => {
    measureQueued = false;
    if (disposed || unmeasuredRows.size === 0) {
      unmeasuredRows.clear();
      return;
    }
    pruneDisconnectedElements();
    for (const element of unmeasuredRows) if (element.isConnected) virtualizer.measureElement(element);
    unmeasuredRows.clear();
  };

  const drawRowsFrom = (index: number): void => {
    if (disposed) return;
    const element = options.getScrollElement();
    const distanceFromEnd = element ? element.scrollHeight - element.scrollTop : undefined;
    drawFrom = index;
    flush(refresh);
    const drawnRows = [...unmeasuredRows];
    measureNewRows();
    for (const row of drawnRows)
      if (row.isConnected)
        virtualizer.resizeItem(virtualizer.indexFromElement(row), Math.round(row.getBoundingClientRect().height));
    if (element && distanceFromEnd !== undefined) {
      element.scrollTop = element.scrollHeight - distanceFromEnd;
      untrack(() => options.onRowsDrawn?.(element));
    }
    untrack(() => options.onChange?.(virtualizer));
  };

  const drawEarlierRows = (): void => {
    drawFrame = undefined;
    if (drawFrom === 0) return;
    drawRowsFrom(Math.max(0, drawFrom - EARLIER_ROWS_PER_FRAME));
    if (drawFrom > 0) drawFrame = requestAnimationFrame(drawEarlierRows);
  };

  const drawAllRows = (then?: () => void): void => {
    if (drawFrom === 0) {
      then?.();
      return;
    }
    if (drawFrame !== undefined) cancelAnimationFrame(drawFrame);
    drawFrame = requestAnimationFrame(() => {
      drawFrame = undefined;
      if (drawFrom > 0) drawRowsFrom(0);
      then?.();
    });
  };

  const opensOtherRows = (count: number): boolean => {
    if (!drawsLatestFirst() || count <= LATEST_ROWS_FIRST || untrack(virtualized)) return false;
    const checkedRows = drawFrom > 0 ? count : count - LATEST_ROWS_FIRST;
    return !Array.from({ length: checkedRows }, (_, index) => options.getItemKey(index)).some((key) =>
      stableItems.has(key),
    );
  };

  const drawLatestRowsFirst = (count: number): void => {
    stopDrawingEarlierRows();
    drawFrom = latestRowsStart(count);
    drawFrame = requestAnimationFrame(() => {
      drawFrame = requestAnimationFrame(drawEarlierRows);
    });
  };

  const refresh = (): void => {
    if (disposed) return;
    const measured = [...virtualizer.getVirtualItems()];
    const count = options.count();
    const isVirtualized = untrack(virtualized);
    if (isVirtualized) stopDrawingEarlierRows();
    drawFrom = Math.min(drawFrom, latestRowsStart(count));
    const items =
      !isVirtualized || measured.length === 0
        ? fallbackItems(
            count,
            fallbackStart(count, isVirtualized ? 0 : drawFrom),
            options.estimateSize,
            options.getItemKey,
            options.scrollMargin(),
          )
        : measured;
    const activeKeys = new Set(items.map((item) => item.key));
    const nextItems = items.map((item) => {
      const existing = stableItems.get(item.key);
      if (existing) {
        if (!virtualItemsEqual(existing.item, item)) existing.update(item);
        return existing.item;
      }
      const [stored, setStored] = createStore(Object.assign({}, item));
      stableItems.set(item.key, { item: stored, update: (next) => setStored(() => next) });
      return stored;
    });
    for (const key of stableItems.keys()) {
      if (!activeKeys.has(key)) stableItems.delete(key);
    }
    setVirtualItems((current) =>
      current.length === nextItems.length && current.every((item, index) => item === nextItems[index])
        ? current
        : nextItems,
    );
    setTotalSize(virtualizer.getTotalSize() || count * options.estimateSize(0));
  };

  const scheduleRefresh = (): void => {
    if (disposed || refreshQueued) return;
    refreshQueued = true;
    queueMicrotask(() => {
      refreshQueued = false;
      refresh();
    });
  };

  let keptRows: SelectedRows | undefined;
  let keptKeys: readonly [VirtualItem["key"], VirtualItem["key"]] | undefined;
  let keptPageIndexes: readonly number[] = [];

  const drawnIndexes = (range: Range): number[] =>
    withKeptIndexes(
      keptRows ? withSelectedRows(range, keptRows) : defaultRangeExtractor(range),
      keptPageIndexes,
      range.count,
    );

  const keepRows = (rows: SelectedRows | undefined): void => {
    if (rows?.[0] === keptRows?.[0] && rows?.[1] === keptRows?.[1]) return;
    keptRows = rows;
    keptKeys = rows && [options.getItemKey(rows[0]), options.getItemKey(rows[1])];
    virtualizer.setOptions({
      ...virtualizer.options,
      rangeExtractor: (range) => drawnIndexes(range),
    });
    scheduleRefresh();
  };

  const selectedRows = (): SelectedRows | undefined => {
    const selection = document.getSelection();
    if (!untrack(virtualized) || !selection?.rangeCount) return undefined;
    const range = selection.getRangeAt(0);
    let first = Number.POSITIVE_INFINITY;
    let last = -1;
    for (const element of virtualizer.elementsCache.values()) {
      if (!element.isConnected || !range.intersectsNode(element)) continue;
      const index = virtualizer.indexFromElement(element);
      first = Math.min(first, index);
      last = Math.max(last, index);
    }
    return last < 0 ? undefined : [first, last];
  };

  const rowsWithKeys = (keys: readonly [VirtualItem["key"], VirtualItem["key"]], count: number) => {
    let first = -1;
    let last = -1;
    for (let index = 0; index < count; index += 1) {
      const key = options.getItemKey(index);
      if (key === keys[0]) first = index;
      if (key === keys[1]) last = index;
    }
    return first < 0 || last < first ? undefined : ([first, last] as const);
  };

  let drawnRowsVersion: unknown;

  createEffect(
    () => {
      const count = options.count();
      return {
        count,
        keyVersion: options.keyVersion(),
        scrollMargin: options.scrollMargin(),
        kept: options.keptIndexes?.() ?? [],
      };
    },
    ({ count, keyVersion, scrollMargin, kept }) => {
      untrack(() => {
        keptPageIndexes = kept;
        const rowsVersion = `${count}:${String(keyVersion)}`;
        if (rowsVersion !== drawnRowsVersion && opensOtherRows(count)) drawLatestRowsFirst(count);
        drawnRowsVersion = rowsVersion;
        if (keptKeys) keepRows(rowsWithKeys(keptKeys, count));
        syncScrollEndThreshold(virtualizer);
        virtualizer.setOptions({
          ...virtualizer.options,
          followOnAppend: options.followLatest || options.stickToLatest?.() === false ? false : "auto",
          count,
          getScrollElement: options.getScrollElement,
          estimateSize: options.estimateSize,
          getItemKey: options.getItemKey,
          scrollMargin,
          rangeExtractor: (range) => drawnIndexes(range),
          onChange: (instance) => {
            scheduleRefresh();
            untrack(() => options.onChange?.(instance));
          },
        });
        pruneDisconnectedElements();
        virtualizer._willUpdate();
      });
      scheduleRefresh();
    },
  );

  createEffect(() => virtualItems(), pruneDisconnectedElements);

  onCleanup(() => {
    disposed = true;
    stopDrawingEarlierRows();
    unmeasuredRows.clear();
    stableItems.clear();
    virtualizer.elementsCache.clear();
  });

  onSettled(() => {
    const cleanup = virtualizer._didMount();
    virtualizer._willUpdate();
    scheduleRefresh();
    const keepSelectedRows = () => keepRows(selectedRows());
    document.addEventListener("selectionchange", keepSelectedRows);
    return () => {
      document.removeEventListener("selectionchange", keepSelectedRows);
      cleanup();
    };
  });

  return {
    getVirtualItems: () => {
      return virtualItems();
    },
    getTotalSize: totalSize,
    isVirtualized: virtualized,
    measureElement: (element) => {
      if (disposed) return;
      if (!element) {
        pruneDisconnectedElements();
        return;
      }
      unmeasuredRows.add(element);
      if (measureQueued) return;
      measureQueued = true;
      queueMicrotask(measureNewRows);
    },
    scrollMargin: options.scrollMargin,
    itemStart: (index) => virtualizer.measurementsCache[index]?.start,
    scrollToIndex: (index, scroll) =>
      drawAllRows(() =>
        virtualizer.scrollToIndex(index, { align: "start", behavior: scroll?.smooth ? "smooth" : "auto" }),
      ),
    scrollToOffset: (offset) => virtualizer.scrollToOffset(offset, { align: "start", behavior: "auto" }),
    firstDrawnIndex: () => drawFrom,
    drawAllRows: () => drawAllRows(),
  };
}

const HISTORY_BOUNDARY_ROWS = 5;
const HISTORY_BOUNDARY_DISTANCE = 80;

export function chatHistoryBoundaryReached(
  scrollElement: HTMLElement | undefined,
  firstRenderedIndex: number,
  followsLatest = false,
): boolean {
  if (!scrollElement) return false;
  const readerTop = followsLatest ? scrollElement.scrollHeight - scrollElement.clientHeight : scrollElement.scrollTop;
  return readerTop <= HISTORY_BOUNDARY_DISTANCE && firstRenderedIndex <= HISTORY_BOUNDARY_ROWS;
}

export function calculateChatScrollMargin(
  scrollElement: HTMLElement | undefined,
  virtualRoot: HTMLElement | undefined,
): number {
  if (!scrollElement || !virtualRoot) return 0;
  return Math.max(
    0,
    virtualRoot.getBoundingClientRect().top - scrollElement.getBoundingClientRect().top + scrollElement.scrollTop,
  );
}

function withKeptIndexes(drawn: number[], kept: readonly number[], count: number): number[] {
  const added = kept.filter((index) => index >= 0 && index < count && !drawn.includes(index));
  return added.length === 0 ? drawn : [...drawn, ...added].sort((left, right) => left - right);
}

function virtualItemsEqual(left: VirtualItem, right: VirtualItem): boolean {
  return (
    left.key === right.key &&
    left.index === right.index &&
    left.start === right.start &&
    left.end === right.end &&
    left.size === right.size &&
    left.lane === right.lane
  );
}

type SelectedRows = readonly [first: number, last: number];

function withSelectedRows(range: Range, [first, last]: SelectedRows): number[] {
  const indexes = new Set(defaultRangeExtractor(range));
  for (let index = first; index <= Math.min(last, range.count - 1); index += 1) indexes.add(index);
  return [...indexes].sort((left, right) => left - right);
}

function fallbackStart(count: number, drawFrom: number): number {
  return count <= STATIC_CHAT_LIMIT ? drawFrom : Math.max(0, count - STATIC_CHAT_RETURN);
}

function fallbackItems(
  count: number,
  startIndex: number,
  estimateSize: (index: number) => number,
  getItemKey: (index: number) => string | number,
  scrollMargin: number,
): VirtualItem[] {
  return Array.from({ length: count - startIndex }, (_, offset): VirtualItem => {
    const index = startIndex + offset;
    const size = estimateSize(index);
    const start = scrollMargin + index * size;
    return { key: getItemKey(index), index, start, end: start + size, size, lane: 0 };
  });
}
