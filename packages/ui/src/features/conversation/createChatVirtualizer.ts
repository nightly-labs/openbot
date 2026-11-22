import {
  elementScroll,
  measureElement as measureRowElement,
  observeElementOffset,
  observeElementRect,
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

  const stopDrawingEarlierRows = (): void => {
    if (drawFrame !== undefined) cancelAnimationFrame(drawFrame);
    drawFrame = undefined;
    drawFrom = 0;
  };

  const unmeasuredRows = new Set<TItemElement>();
  let measureQueued = false;

  const measureNewRows = (): void => {
    measureQueued = false;
    for (const element of unmeasuredRows) if (element.isConnected) virtualizer.measureElement(element);
    unmeasuredRows.clear();
  };

  const drawRowsFrom = (index: number): void => {
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
    if (refreshQueued) return;
    refreshQueued = true;
    queueMicrotask(() => {
      refreshQueued = false;
      refresh();
    });
  };

  let drawnRowsVersion: unknown;

  createEffect(
    () => {
      const count = options.count();
      return {
        count,
        keyVersion: options.keyVersion(),
        scrollMargin: options.scrollMargin(),
      };
    },
    ({ count, keyVersion, scrollMargin }) => {
      untrack(() => {
        const rowsVersion = `${count}:${String(keyVersion)}`;
        if (rowsVersion !== drawnRowsVersion && opensOtherRows(count)) drawLatestRowsFirst(count);
        drawnRowsVersion = rowsVersion;
        syncScrollEndThreshold(virtualizer);
        virtualizer.setOptions({
          ...virtualizer.options,
          followOnAppend: options.followLatest || options.stickToLatest?.() === false ? false : "auto",
          count,
          getScrollElement: options.getScrollElement,
          estimateSize: options.estimateSize,
          getItemKey: options.getItemKey,
          scrollMargin,
          onChange: (instance) => {
            scheduleRefresh();
            untrack(() => options.onChange?.(instance));
          },
        });
        virtualizer._willUpdate();
      });
      scheduleRefresh();
    },
  );

  onCleanup(stopDrawingEarlierRows);

  onSettled(() => {
    const cleanup = virtualizer._didMount();
    virtualizer._willUpdate();
    scheduleRefresh();
    return cleanup;
  });

  return {
    getVirtualItems: () => {
      return virtualItems();
    },
    getTotalSize: totalSize,
    isVirtualized: virtualized,
    measureElement: (element) => {
      if (!element) {
        virtualizer.measureElement(null);
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
