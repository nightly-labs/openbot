import {
  defaultRangeExtractor,
  elementScroll,
  observeElementOffset,
  observeElementRect,
  type VirtualItem,
  Virtualizer,
} from "@tanstack/virtual-core";
import { type Accessor, createEffect, createSignal, onSettled, untrack } from "solid-js";
import { prefersReducedMotion } from "../utils";

/** One row: a key that is unique in the list, and a first guess of its height. It is measured when it renders. */
interface ListRow {
  key: string;
  size: number;
}

interface ListVirtualizerOptions {
  rows: Accessor<ListRow[]>;
  getScrollElement: () => HTMLElement | undefined;
  /** The distance from the top of the scroll content to the top of the list. */
  scrollMargin: Accessor<number>;
  /** A row that stays rendered out of view, such as the active option, or -1. */
  pinnedIndex: Accessor<number>;
  overscan: number;
}

export interface ListVirtualizer {
  items: Accessor<VirtualItem[]>;
  totalSize: Accessor<number>;
  /** The last row in view. */
  endIndex: Accessor<number>;
  measureElement: (element: HTMLElement) => void;
  /**
   * Scrolls the fewest pixels that show the rows from `fromIndex` to `toIndex`, with the scroll
   * padding of the scroll element around them. A short scroll is smooth; a long one jumps.
   */
  reveal: (fromIndex: number, toIndex: number) => void;
}

/** A scroll longer than this many screens jumps: a smooth scroll that long is slow to follow. */
const SMOOTH_SCROLL_SCREENS = 2;
/**
 * The view to use while the scroll element has no height, as before its first layout and in jsdom.
 * With no height, the virtualizer renders no row, and the scroll element can take its height only
 * from its rows.
 */
const FALLBACK_RECT = { width: 0, height: 400 };

/** A vertical list that renders only the rows near the view of its scroll element. */
export function createListVirtualizer(options: ListVirtualizerOptions): ListVirtualizer {
  const [items, setItems] = createSignal<VirtualItem[]>([]);
  const [totalSize, setTotalSize] = createSignal(0);
  const [endIndex, setEndIndex] = createSignal(0);
  let refreshQueued = false;
  // The virtualizer reads rows outside a tracking scope, so it gets a plain copy.
  let rows: ListRow[] = [];

  const virtualizer = new Virtualizer<HTMLElement, HTMLElement>({
    count: 0,
    getScrollElement: () => options.getScrollElement() ?? null,
    estimateSize: (index) => rows[index]?.size ?? 0,
    getItemKey: (index) => rows[index]?.key ?? index,
    observeElementRect: (instance, callback) =>
      observeElementRect(instance, (rect) => callback(rect.height > 0 ? rect : FALLBACK_RECT)),
    observeElementOffset,
    scrollToFn: elementScroll,
    overscan: options.overscan,
  });

  const refresh = (): void => {
    setItems(() => virtualizer.getVirtualItems());
    setTotalSize(virtualizer.getTotalSize());
    setEndIndex(virtualizer.range?.endIndex ?? 0);
  };

  // The virtualizer reports each scroll and measure; one update per task is enough to render.
  const scheduleRefresh = (): void => {
    if (refreshQueued) return;
    refreshQueued = true;
    queueMicrotask(() => {
      refreshQueued = false;
      refresh();
    });
  };

  createEffect(
    () => ({ next: options.rows(), scrollMargin: options.scrollMargin(), pinned: options.pinnedIndex() }),
    ({ next, scrollMargin, pinned }) => {
      rows = next;
      untrack(() => {
        virtualizer.setOptions({
          ...virtualizer.options,
          count: next.length,
          scrollMargin,
          // New functions tell the virtualizer that the keys or the pinned row changed.
          getItemKey: (index) => rows[index]?.key ?? index,
          rangeExtractor: (range) => {
            const indexes = defaultRangeExtractor(range);
            if (pinned < 0 || pinned >= range.count || indexes.includes(pinned)) return indexes;
            return [...indexes, pinned].sort((a, b) => a - b);
          },
          onChange: scheduleRefresh,
        });
        virtualizer._willUpdate();
      });
      scheduleRefresh();
    },
  );

  onSettled(() => {
    const cleanup = virtualizer._didMount();
    virtualizer._willUpdate();
    scheduleRefresh();
    return cleanup;
  });

  function reveal(fromIndex: number, toIndex: number): void {
    const element = options.getScrollElement();
    const from = virtualizer.measurementsCache[fromIndex];
    const to = virtualizer.measurementsCache[toIndex];
    if (!element || !from || !to || typeof element.scrollTo !== "function") return;
    const style = getComputedStyle(element);
    const paddingTop = Number.parseFloat(style.scrollPaddingTop) || 0;
    const paddingBottom = Number.parseFloat(style.scrollPaddingBottom) || 0;
    const viewTop = element.scrollTop;
    const viewBottom = viewTop + element.clientHeight;
    // The first row goes to the very top, so that nothing above it stays hidden.
    const top = fromIndex === 0 ? 0 : from.start - paddingTop;
    const bottom = to.end + paddingBottom;
    let target: number | undefined;
    if (top < viewTop) target = top;
    else if (bottom > viewBottom) target = Math.min(top, bottom - element.clientHeight);
    if (target === undefined) return;
    const far = Math.abs(target - viewTop) > element.clientHeight * SMOOTH_SCROLL_SCREENS;
    element.scrollTo({ top: Math.max(0, target), behavior: far || prefersReducedMotion() ? "auto" : "smooth" });
  }

  return {
    items,
    totalSize,
    endIndex,
    measureElement: (element) => {
      // Solid can run a ref before the row's data-index and contents are committed.
      queueMicrotask(() => {
        if (element.isConnected) virtualizer.measureElement(element);
      });
    },
    reveal,
  };
}
