/**
 * The finished-work shelf beside the agent dock. It shows the three newest results that the user did
 * not read yet. Older ones fold into "+N more". Each result hides some seconds after it came; the seat
 * keeps the unread badge. While the pointer is on the dock or on the shelf the clock stops and the
 * hidden results come back, so nothing goes while the user looks at it.
 */

import { Button, FileText, MessageSquareText } from "@openbot/ui";
import { createEffect, createMemo, createSignal, For, onSettled, Show, untrack } from "solid-js";
import type { ComposerAgent } from "../../data";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";

/** A file or an answer that an agent finished. `at` is when it came, in milliseconds since the epoch. */
export interface AgentDockShelfResult {
  id: string;
  agentId: string;
  kind: "file" | "message";
  label: string;
  at: number;
}

/** The shelf shows this many results; the others fold into "+N more". */
const SHOWN = 3;
/** A result hides this long after it came, while nobody looks at the dock. */
const LIFE = 8000;
/** A result that hides fades out for this long. */
const LEAVE = 300;
/** Looking ends this long after the pointer leaves the dock and the shelf: it crosses a gap between them. */
const LOOK_GRACE = 600;
const CLOCK_STEP = 100;
/** The parts of the dock where the pointer shows that the user looks at it. */
const LOOK_TARGETS = ".agent-dock-seats, .agent-dock-hit, .agent-dock-shelf";

export interface AgentDockShelfProps {
  /** The unread results, oldest first. */
  results: readonly AgentDockShelfResult[];
  agent: (agentId: string) => ComposerAgent | undefined;
  /** The shelf hides, for example while a chat is open. */
  hidden: boolean;
  /** The dock stage. The pointer on its seats, body or shelf stops the clock. */
  stage: () => HTMLElement | undefined;
  onOpen: (agentId: string) => void;
  /** Called when the shelf shows results and when it becomes empty. */
  onShownChange?: ((shown: boolean) => void) | undefined;
  ref: (element: HTMLUListElement) => void;
}

export function AgentDockShelf(props: AgentDockShelfProps) {
  const { t } = useText();
  /** The shelf clock. It does not move while the user looks at the dock. */
  const [clock, setClock] = createSignal(0);
  const [looking, setLooking] = createSignal(false);
  const [expanded, setExpanded] = createSignal(false);
  /* The shelf clock time when each result came. A result that is older than the dock starts older. */
  const came = new Map<string, number>();

  /* While the user looks, every age is 0: the hidden results come back. */
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

  /* The clock moves only while a result shows and can hide. */
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
    /* A result that came back while the user looked fades out when the look ends; it does not vanish. */
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
        <li class="agent-dock-shelf-item">
          <Button type="button" variant="ghost" class="agent-dock-shelf-more" onClick={() => setExpanded(true)}>
            {t("agent.dock.finished.more", { count: folded() })}
          </Button>
        </li>
      </Show>
      <For each={shown()} keyed={(result) => result.id}>
        {(result) => (
          <li class="agent-dock-shelf-item" data-leaving={age(result().id) >= LIFE ? "" : undefined}>
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
