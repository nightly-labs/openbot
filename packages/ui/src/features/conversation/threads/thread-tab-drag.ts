import { createSignal } from "solid-js";
import type { ThreadItem } from "./thread-types";

export type ThreadTabRow = "chat" | "side";

interface ThreadTabCarry {
  thread: ThreadItem;
  from: ThreadTabRow;
  x: number;
  y: number;
}

const [carried, setCarried] = createSignal<ThreadTabCarry | null>(null);

export const carriedThreadTab = carried;
export const setCarriedThreadTab = setCarried;

export function sidePanelTabRow(element: Element): HTMLElement | null {
  return element.closest(".conversation-panel")?.querySelector<HTMLElement>(":scope > .side-panel-header") ?? null;
}

export function swallowNextClick(): void {
  const swallow = (click: MouseEvent) => {
    click.preventDefault();
    click.stopPropagation();
  };
  window.addEventListener("click", swallow, { capture: true, once: true });
  requestAnimationFrame(() => window.removeEventListener("click", swallow, { capture: true }));
}
