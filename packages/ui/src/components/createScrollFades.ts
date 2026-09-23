import { createStore } from "solid-js";

/** Slack in pixels before an edge counts as reached, absorbing sub-pixel scroll positions. */
const EDGE_EPSILON = 2;

/** Top/bottom fade flags in one store; `bind`+`measure`, `adopt` for owned observers. */
export function createScrollFades() {
  const [fades, setFades] = createStore({ bottom: false, top: false });
  let element: Element | undefined;
  let resizeObserver: ResizeObserver | undefined;

  function measure(): void {
    if (!element) return;
    const remaining = element.scrollHeight - element.scrollTop - element.clientHeight;
    const top = element.scrollTop > EDGE_EPSILON;
    const bottom = remaining > EDGE_EPSILON;
    setFades((state) => {
      state.top = top;
      state.bottom = bottom;
    });
  }

  function remeasure(): void {
    window.requestAnimationFrame(measure);
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

  function classes(): Record<string, boolean> {
    return { "scroll-fade-top": fades.top, "scroll-fade-bottom": fades.bottom };
  }

  function stop(): void {
    resizeObserver?.disconnect();
    resizeObserver = undefined;
  }

  return { adopt, bind, classes, measure, remeasure, stop };
}
