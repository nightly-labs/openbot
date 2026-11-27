import { Button, FileText, MessageSquareText } from "@openbot/ui";
import { createEffect, createMemo, createSignal, For, onSettled, Show, untrack } from "solid-js";
import type { ComposerAgent } from "../../data";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";

export interface AgentDockShelfResult {
  id: string;
  agentId: string;
  kind: "file" | "message";
  label: string;
  at: number;
}

const SHOWN = 3;
const LIFE = 8000;
const LEAVE = 300;
const LOOK_GRACE = 600;
const CLOCK_STEP = 100;
const LOOK_TARGETS = ".agent-dock-seats, .agent-dock-hit, .agent-dock-shelf";
const MORE_KEY = "more";

export interface AgentDockShelfItem {
  key: string;
  agentId: string | null;
  element: HTMLLIElement;
}

export interface AgentDockShelfProps {
  results: readonly AgentDockShelfResult[];
  agent: (agentId: string) => ComposerAgent | undefined;
  hidden: boolean;
  stage: () => HTMLElement | undefined;
  onOpen: (agentId: string) => void;
  onShownChange?: ((shown: boolean) => void) | undefined;
  onItemsChange?: ((items: readonly AgentDockShelfItem[], shown: boolean) => void) | undefined;
  ref: (element: HTMLUListElement) => void;
}

export function AgentDockShelf(props: AgentDockShelfProps) {
  const { t } = useText();
  const [clock, setClock] = createSignal(0);
  const [looking, setLooking] = createSignal(false);
  const [expanded, setExpanded] = createSignal(false);
  const came = new Map<string, number>();

  const ages = createMemo(() => {
    const now = clock();
    const look = looking();
    const next = new Map<string, number>();
    for (const result of props.results) {
      let start = came.get(result.id);
      if (start === undefined) {
        start = now - Math.max(0, Date.now() - result.at);
        came.set(result.id, start);
      }
      next.set(result.id, look ? 0 : now - start);
    }
    for (const id of came.keys()) if (!next.has(id)) came.delete(id);
    return next;
  });
  const age = (id: string) => ages().get(id) ?? 0;
  const live = createMemo(() => props.results.filter((result) => age(result.id) < LIFE + LEAVE));
  const shown = createMemo(() => {
    const all = live();
    return expanded() && all.length > SHOWN ? all : all.slice(-SHOWN);
  });
  const folded = () => live().length - shown().length;
  const visible = () => !props.hidden && live().length > 0;

  createEffect(
    () => live().length > 0 && !looking(),
    (running) => {
      if (!running) return;
      const timer = window.setInterval(() => setClock((value) => value + CLOCK_STEP), CLOCK_STEP);
      return () => window.clearInterval(timer);
    },
  );

  createEffect(
    () => live().length === 0,
    (empty) => {
      if (empty) setExpanded(false);
    },
  );

  const elements = new Map<string, HTMLLIElement>();
  createEffect(
    () => [visible(), folded() > 0, ...shown().map((result) => result.id)].join("\n"),
    () => {
      const keys = untrack(() => [...(folded() > 0 ? [MORE_KEY] : []), ...shown().map((result) => result.id)]);
      for (const key of elements.keys()) if (!keys.includes(key)) elements.delete(key);
      const agents = new Map(untrack(shown).map((result) => [result.id, result.agentId]));
      const items = keys.flatMap((key) => {
        const element = elements.get(key);
        return element ? [{ key, agentId: agents.get(key) ?? null, element }] : [];
      });
      untrack(() => props.onItemsChange?.(items, visible()));
    },
  );

  createEffect(visible, (value) => {
    untrack(() => props.onShownChange?.(value));
  });

  onSettled(() => {
    let grace = 0;
    const look = (on: boolean) => {
      window.clearTimeout(grace);
      if (on) setLooking(true);
      else if (untrack(looking)) grace = window.setTimeout(endLook, LOOK_GRACE);
    };
    const endLook = () => {
      const now = untrack(clock);
      for (const [id, start] of came) came.set(id, Math.max(start, now - LIFE));
      setLooking(false);
    };
    const move = (event: PointerEvent) => {
      const target = event.target;
      const stage = props.stage();
      look(target instanceof Element && !!stage?.contains(target) && target.closest(LOOK_TARGETS) !== null);
    };
    const leave = () => look(false);
    window.addEventListener("pointermove", move);
    document.documentElement.addEventListener("pointerleave", leave);
    return () => {
      window.clearTimeout(grace);
      window.removeEventListener("pointermove", move);
      document.documentElement.removeEventListener("pointerleave", leave);
    };
  });

  return (
    <ul
      class="agent-dock-shelf"
      aria-label={t("agent.dock.finished.label")}
      ref={props.ref}
      hidden={visible() ? undefined : true}
    >
      <Show when={folded() > 0}>
        <li class="agent-dock-shelf-item" ref={(element) => elements.set(MORE_KEY, element)}>
          <Button type="button" variant="ghost" class="agent-dock-shelf-more" onClick={() => setExpanded(true)}>
            {t("agent.dock.finished.more", { count: folded() })}
          </Button>
        </li>
      </Show>
      <For each={shown()} keyed={(result) => result.id}>
        {(result) => (
          <li
            class="agent-dock-shelf-item"
            data-leaving={age(result().id) >= LIFE ? "" : undefined}
            ref={(element) => elements.set(untrack(result).id, element)}
          >
            <Show when={props.agent(result().agentId)}>
              {(agent) => (
                <Button
                  type="button"
                  variant="ghost"
                  class="agent-dock-result"
                  aria-label={t("agent.dock.finished.result", { label: result().label, name: agent().name })}
                  onClick={() => props.onOpen(result().agentId)}
                >
                  <AgentAvatar agent={agent()} mood="responded" motion="idle" />
                  <Show when={result().kind === "file"} fallback={<MessageSquareText aria-hidden="true" />}>
                    <FileText aria-hidden="true" />
                  </Show>
                  <span class="agent-dock-result-label">{result().label}</span>
                </Button>
              )}
            </Show>
          </li>
        )}
      </For>
    </ul>
  );
}
