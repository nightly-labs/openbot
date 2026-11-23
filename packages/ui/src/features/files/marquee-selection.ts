import { createSignal, onCleanup } from "solid-js";

export interface MarqueeBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface ItemBox {
  id: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface Drag {
  pointerId: number;
  startX: number;
  startY: number;
  clientX: number;
  clientY: number;
  originX: number;
  originY: number;
  additive: boolean;
  started: boolean;
  contentHeight: number;
  items: ItemBox[];
  frame: number;
}

const DRAG_THRESHOLD = 6;
const SCROLL_EDGE = 48;
const SCROLL_SPEED = 18;
const NO_DRAG =
  'input, textarea, select, a, label, [contenteditable="true"], [role="menu"], .library-pill, button:not(.library-file-card, .library-picture, .library-folder-tile-main, .file-row-main)';

export interface MarqueeSelectionOptions {
  enabled: () => boolean;
  onStart: (additive: boolean) => void;
  onChange: (ids: ReadonlySet<string>) => void;
  onCancel: () => void;
}

export function createMarqueeSelection(options: MarqueeSelectionOptions) {
  const [box, setBox] = createSignal<MarqueeBox | null>(null);
  let scroller: HTMLElement | undefined;
  let drag: Drag | null = null;

  const contentPoint = (clientX: number, clientY: number) => {
    if (!scroller) return { x: clientX, y: clientY };
    const frame = scroller.getBoundingClientRect();
    return {
      x: clientX - frame.left - scroller.clientLeft + scroller.scrollLeft,
      y: clientY - frame.top - scroller.clientTop + scroller.scrollTop,
    };
  };

  function measureItems(): ItemBox[] {
    if (!scroller) return [];
    const items: ItemBox[] = [];
    for (const element of scroller.querySelectorAll<HTMLElement>("[data-file-id]")) {
      const id = element.dataset.fileId;
      if (!id) continue;
      const rect = element.getBoundingClientRect();
      const start = contentPoint(rect.left, rect.top);
      items.push({ id, left: start.x, top: start.y, right: start.x + rect.width, bottom: start.y + rect.height });
    }
    return items;
  }

  function update(current: Drag): void {
    const point = contentPoint(current.clientX, current.clientY);
    const y = Math.min(Math.max(point.y, 0), current.contentHeight);
    const left = Math.min(current.originX, point.x);
    const top = Math.min(current.originY, y);
    const right = Math.max(current.originX, point.x);
    const bottom = Math.max(current.originY, y);
    setBox({ left, top, width: right - left, height: bottom - top });
    const ids = new Set<string>();
    for (const item of current.items) {
      if (item.left < right && item.right > left && item.top < bottom && item.bottom > top) ids.add(item.id);
    }
    options.onChange(ids);
  }

  function scrollStep(): void {
    const current = drag;
    if (!current || !scroller) return;
    const frame = scroller.getBoundingClientRect();
    const above = frame.top + SCROLL_EDGE - current.clientY;
    const below = current.clientY - (frame.bottom - SCROLL_EDGE);
    const depth = above > 0 ? -Math.min(above, SCROLL_EDGE) : below > 0 ? Math.min(below, SCROLL_EDGE) : 0;
    if (depth !== 0) {
      const before = scroller.scrollTop;
      scroller.scrollTop += (depth / SCROLL_EDGE) * SCROLL_SPEED;
      if (scroller.scrollTop !== before) {
        current.contentHeight = scroller.scrollHeight;
        current.items = measureItems();
        update(current);
      }
    }
    current.frame = requestAnimationFrame(scrollStep);
  }

  function start(current: Drag): void {
    current.started = true;
    current.contentHeight = scroller?.scrollHeight ?? 0;
    current.items = measureItems();
    scroller?.setAttribute("data-marquee", "");
    window.getSelection()?.removeAllRanges();
    options.onStart(current.additive);
    update(current);
    current.frame = requestAnimationFrame(scrollStep);
  }

  function swallowNextClick(): void {
    const swallow = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
  }

  function swallowAfterRelease(pointerId: number): void {
    const onRelease = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      window.removeEventListener("pointerup", onRelease, true);
      window.removeEventListener("pointercancel", onRelease, true);
      if (event.type === "pointerup") swallowNextClick();
    };
    window.addEventListener("pointerup", onRelease, true);
    window.addEventListener("pointercancel", onRelease, true);
  }

  function finish(cancelled: boolean, released = true): void {
    const current = drag;
    if (!current) return;
    drag = null;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerCancel);
    window.removeEventListener("keydown", onKeyDown, true);
    cancelAnimationFrame(current.frame);
    if (!current.started) return;
    scroller?.removeAttribute("data-marquee");
    setBox(null);
    if (cancelled) options.onCancel();
    if (released) swallowNextClick();
    else swallowAfterRelease(current.pointerId);
  }

  function onPointerMove(event: PointerEvent): void {
    const current = drag;
    if (!current || event.pointerId !== current.pointerId) return;
    current.clientX = event.clientX;
    current.clientY = event.clientY;
    if (current.started) {
      update(current);
      return;
    }
    if (Math.hypot(event.clientX - current.startX, event.clientY - current.startY) >= DRAG_THRESHOLD) start(current);
  }

  function onPointerUp(event: PointerEvent): void {
    if (event.pointerId === drag?.pointerId) finish(false);
  }

  function onPointerCancel(event: PointerEvent): void {
    if (event.pointerId === drag?.pointerId) finish(true);
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key !== "Escape" || !drag?.started) return;
    event.preventDefault();
    event.stopPropagation();
    finish(true, false);
  }

  function onPointerDown(event: PointerEvent): void {
    if (drag || event.button !== 0 || event.pointerType === "touch" || !options.enabled() || !scroller) return;
    const target = event.target;
    if (!(target instanceof Element) || !scroller.contains(target) || target.closest(NO_DRAG)) return;
    const origin = contentPoint(event.clientX, event.clientY);
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      clientX: event.clientX,
      clientY: event.clientY,
      originX: origin.x,
      originY: origin.y,
      additive: event.shiftKey || event.metaKey || event.ctrlKey,
      started: false,
      contentHeight: 0,
      items: [],
      frame: 0,
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("keydown", onKeyDown, true);
  }

  onCleanup(() => {
    finish(false);
    scroller?.removeEventListener("pointerdown", onPointerDown);
  });

  return {
    box,
    attach(element: HTMLElement): void {
      scroller?.removeEventListener("pointerdown", onPointerDown);
      scroller = element;
      element.addEventListener("pointerdown", onPointerDown);
    },
  };
}
