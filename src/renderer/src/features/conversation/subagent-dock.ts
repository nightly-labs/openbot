import type { ConversationSubagent } from "@openbot/contracts/ipc";
import type { AgentMessage } from "@openbot/ui/data";
import type { VirtualItem } from "@tanstack/virtual-core";
import { createEffect, createMemo, createSignal, untrack } from "solid-js";

export interface SubagentDockDeps {
  /** The rows of the chat, oldest first. */
  rows: () => readonly AgentMessage[];
  /** The rows that the virtualizer draws now. */
  drawnRows: () => readonly VirtualItem[];
  scrollElement: () => HTMLElement | undefined;
  /** True while something covers the chat, such as a side thread. */
  hidden: () => boolean;
}

const working = (subagent: ConversationSubagent) => subagent.status === "running";

/**
 * The newest subagent card in the chat whose subagents still work, and whether the reader is away
 * from it: its header is out of the chat view, or its row is so far away that it is not drawn.
 * Call `update` when the chat scrolls.
 */
export function createSubagentDock(deps: SubagentDockDeps) {
  const card = createMemo(() =>
    deps.rows().findLast((message) => message.kind === "subagents" && message.subagents?.some(working) === true),
  );
  const [away, setAway] = createSignal(false);
  // The bar morphs back to the card after its subagents end, so the card stays known.
  let lastCardId: string | undefined;

  function header(id: string): HTMLElement | undefined {
    const article = deps.scrollElement()?.querySelector<HTMLElement>(`[data-chat-search-message="${CSS.escape(id)}"]`);
    return article?.querySelector<HTMLElement>(".subagents-group-header") ?? article ?? undefined;
  }

  function update(): void {
    const scroller = deps.scrollElement();
    const current = untrack(card);
    if (!scroller || !current) {
      setAway(false);
      return;
    }
    lastCardId = current.id;
    const element = header(current.id);
    if (!element) {
      // A drawn row whose element is not there yet keeps the last state.
      if (!untrack(deps.drawnRows).some((row) => row.key === current.id)) setAway(true);
      return;
    }
    const view = scroller.getBoundingClientRect();
    const box = element.getBoundingClientRect();
    setAway(box.bottom <= view.top || box.top >= view.bottom);
  }

  createEffect(
    () => [card()?.id, deps.drawnRows(), deps.hidden()] as const,
    () => {
      const frame = requestAnimationFrame(update);
      return () => cancelAnimationFrame(frame);
    },
  );

  return {
    update,
    /** The subagents of the card while the reader is away from it and one of them works. */
    subagents: (): readonly ConversationSubagent[] | undefined =>
      !deps.hidden() && away() ? card()?.subagents : undefined,
    /** The header of the card, held inside the chat view, so that the bar morphs from and to its edge. */
    cardHeader(): DOMRect | undefined {
      const scroller = deps.scrollElement();
      const element = lastCardId ? header(lastCardId) : undefined;
      if (!scroller || !element) return undefined;
      const view = scroller.getBoundingClientRect();
      const box = element.getBoundingClientRect();
      const top = Math.min(Math.max(box.top, view.top), view.bottom - box.height);
      return new DOMRect(box.left, top, box.width, box.height);
    },
    /** The card to scroll back to. */
    cardId: () => card()?.id,
  };
}
