import type { ConversationSubagent } from "@openbot/contracts/ipc";
import type { AgentMessage } from "@openbot/ui/data";
import type { VirtualItem } from "@tanstack/virtual-core";
import { createEffect, createMemo, createSignal, untrack } from "solid-js";

export interface SubagentDockDeps {
  rows: () => readonly AgentMessage[];
  drawnRows: () => readonly VirtualItem[];
  scrollElement: () => HTMLElement | undefined;
  hidden: () => boolean;
}

const working = (subagent: ConversationSubagent) => subagent.status === "running";

export function createSubagentDock(deps: SubagentDockDeps) {
  const card = createMemo(() =>
    deps.rows().findLast((message) => message.kind === "subagents" && message.subagents?.some(working) === true),
  );
  const [away, setAway] = createSignal(false);
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
    subagents: (): readonly ConversationSubagent[] | undefined =>
      !deps.hidden() && away() ? card()?.subagents : undefined,
    cardHeader(): DOMRect | undefined {
      const scroller = deps.scrollElement();
      const element = lastCardId ? header(lastCardId) : undefined;
      if (!scroller || !element) return undefined;
      const view = scroller.getBoundingClientRect();
      const box = element.getBoundingClientRect();
      const top = Math.min(Math.max(box.top, view.top), view.bottom - box.height);
      return new DOMRect(box.left, top, box.width, box.height);
    },
    cardId: () => card()?.id,
  };
}
