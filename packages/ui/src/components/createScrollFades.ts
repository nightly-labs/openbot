import { createStore } from "solid-js";

const EDGE_EPSILON = 2;

export function createScrollFades(options: { stuck?: string } = {}) {
  const [fades, setFades] = createStore({ bottom: false, stuckHeight: 0, top: false });
  let element: Element | undefined;
  let resizeObserver: ResizeObserver | undefined;
  let contentObserver: ResizeObserver | undefined;
  let frame: number | undefined;

  function measureStuck(scroller: Element, selector: string): number {
    const top = scroller.getBoundingClientRect().top;
    const inset = scroller.clientTop + Number.parseFloat(getComputedStyle(scroller).paddingTop);
    let bottom = 0;
    for (const item of scroller.querySelectorAll<HTMLElement>(selector)) {
      if (item.closest("[inert]")) continue;
      const rect = item.getBoundingClientRect();
      if (rect.bottom > top && rect.top - top <= inset + Number.parseFloat(getComputedStyle(item).top) + 1) {
        bottom = Math.max(bottom, rect.bottom - top);
      }
    }
    return bottom;
  }

  function measure(): void {
    if (!element) return;
    const remaining = element.scrollHeight - element.scrollTop - element.clientHeight;
    const top = element.scrollTop > EDGE_EPSILON;
    const bottom = remaining > EDGE_EPSILON;
    const stuckHeight = top && options.stuck ? measureStuck(element, options.stuck) : 0;
    setFades((state) => {
      state.top = top;
      state.bottom = bottom;
      state.stuckHeight = stuckHeight;
    });
  }

  function remeasure(): void {
    frame ??= window.requestAnimationFrame(() => {
      frame = undefined;
      measure();
    });
  }

  function adopt(next: Element): void {
    element = next;
  }

  function bind(next: Element): void {
    adopt(next);
    resizeObserver?.disconnect();
    resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(next);
    remeasure();
  }

  function watch(content: Element): void {
    contentObserver ??= new ResizeObserver(measure);
    contentObserver.observe(content);
  }

  function classes(): Record<string, boolean> {
    return { "scroll-fade-top": fades.top, "scroll-fade-bottom": fades.bottom };
  }

  function stop(): void {
    resizeObserver?.disconnect();
    resizeObserver = undefined;
    contentObserver?.disconnect();
    contentObserver = undefined;
    if (frame !== undefined) window.cancelAnimationFrame(frame);
    frame = undefined;
  }

  function stuckHeight(): number {
    return fades.stuckHeight;
  }

  function top(): boolean {
    return fades.top;
  }

  function bottom(): boolean {
    return fades.bottom;
  }

  return { adopt, bind, bottom, classes, measure, remeasure, stop, stuckHeight, top, watch };
}
