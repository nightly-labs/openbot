import { createSignal } from "solid-js";
import type { ThreadItem } from "./thread-types";

/** Where a thread tab is: in the chat header or in the side panel. */
export type ThreadTabRow = "chat" | "side";

/**
 * A thread tab that the pointer takes over the other row. A drop there moves the thread to that row.
 * Only one pointer moves a tab at a time, so one value serves the chat header and the side panel.
 */
interface ThreadTabCarry {
  thread: ThreadItem;
  from: ThreadTabRow;
  /** The pointer, in viewport pixels. */
  x: number;
  y: number;
}

const [carried, setCarried] = createSignal<ThreadTabCarry | null>(null);

/** The tab that the pointer holds over the other row now. */
export const carriedThreadTab = carried;
export const setCarriedThreadTab = setCarried;

/** The side panel tab row of the chat that holds `element`, while the side panel is open. */
export function sidePanelTabRow(element: Element): HTMLElement | null {
  return element.closest(".conversation-panel")?.querySelector<HTMLElement>(":scope > .side-panel-header") ?? null;
}

/** The click that ends a drag does not also select the tab under the pointer. */
export function swallowNextClick(): void {
  const swallow = (click: MouseEvent) => {
    click.preventDefault();
    click.stopPropagation();
  };
  window.addEventListener("click", swallow, { capture: true, once: true });
  requestAnimationFrame(() => window.removeEventListener("click", swallow, { capture: true }));
}
