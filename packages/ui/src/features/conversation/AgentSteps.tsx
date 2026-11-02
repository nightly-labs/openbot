import type { ConversationMemoryChange } from "@openbot/contracts/ipc";
import { countConversationMemoryChanges } from "@openbot/contracts/ipc";
import type { JSX } from "@solidjs/web";
import { createEffect, createMemo, createSignal, createUniqueId, For, onSettled, Show } from "solid-js";
import { Badge } from "../../badge";
import { Button } from "../../button";
import { Brain, ChevronRight, Puzzle, Sparkles } from "../../icons";
import { type TextValue, useText } from "../../text";
import { prefersReducedMotion } from "../../utils";
import { useDuration } from "./Subagents";
import { type TraceKeyboard, type TraceSpan, TraceWaterfallDialog } from "./TraceWaterfall";

/**
 * One step of an agent's turn: a thought, a progress line of the host, or a memory change that the
 * turn committed. `memory-summary` is the count that a host without the changes sends instead.
 * The text of `progress` and `memory-summary` is the host's English source text.
 */
export type AgentStep =
  | { id: string; kind: "thinking"; text: string }
  | { id: string; kind: "progress"; text: string }
  | { id: string; kind: "memory"; change: ConversationMemoryChange }
  | { id: string; kind: "memory-summary"; text: string };

/** How tall the list grows before it scrolls, and before a live list glides to its newest step. */
const STEPS_MAX_HEIGHT = 220;

const MEMORY_ACTION_LABEL = {
  saved: "chat.steps.saved",
  updated: "chat.steps.updated",
  forgotten: "chat.steps.forgotten",
  notChanged: "chat.steps.notChanged",
} as const;

/**
 * The steps of a turn, in order. While the turn runs, `live` marks the newest step and the list
 * glides so that step stays at the bottom edge; after the turn the list scrolls.
 */
export function AgentStepList(props: {
  steps: readonly AgentStep[];
  live: boolean;
  id?: string;
  /** The step to scroll to and light up, such as the one that the user picked in the trace. */
  focus?: { id: string } | null | undefined;
}) {
  const { t } = useText();
  const [contentHeight, setContentHeight] = createSignal(0);
  let content: HTMLOListElement | undefined;
  onSettled(() => {
    const element = content;
    if (!element) return;
    const observer = new ResizeObserver(() => setContentHeight(element.offsetHeight));
    observer.observe(element);
    return () => observer.disconnect();
  });
  createEffect(
    () => props.focus,
    (focus) => {
      if (!focus) return;
      const step = content?.querySelector(`[data-step-id="${CSS.escape(focus.id)}"]`);
      step?.scrollIntoView({ block: "center", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    },
  );
  const capped = () => contentHeight() > STEPS_MAX_HEIGHT;
  const scrolls = () => !props.live && capped();
  const offset = () => (props.live && capped() ? STEPS_MAX_HEIGHT - contentHeight() : 0);
  return (
    <section
      id={props.id}
      class="agent-steps-viewport"
      aria-label={t("chat.steps.list")}
      data-capped={capped() ? "" : undefined}
      data-scrolls={scrolls() ? "" : undefined}
      // A list that scrolls needs a keyboard stop of its own.
      tabindex={scrolls() ? 0 : undefined}
    >
      <ol ref={content} class="agent-steps-list" style={{ transform: `translateY(${offset()}px)` }}>
        <For each={props.steps} keyed={(step) => step.id}>
          {(step, index) => (
            <li
              class="agent-step"
              data-kind={step().kind}
              data-step-id={step().id}
              data-focused={props.focus?.id === step().id ? "" : undefined}
            >
              <StepIcon kind={step().kind} />
              <StepBody step={step()} newest={props.live && index() === props.steps.length - 1} />
            </li>
          )}
        </For>
      </ol>
    </section>
  );
}

function StepBody(props: { step: AgentStep; newest: boolean }) {
  const text = useText();
  return <>{stepBody(props.step, props.newest, text)}</>;
}

function stepBody(step: AgentStep, newest: boolean, text: TextValue): JSX.Element {
  if (step.kind === "memory") {
    const change = step.change;
    return (
      <span class="agent-step-memory" data-action={change.action}>
        <span class="agent-step-memory-action">{text.t(MEMORY_ACTION_LABEL[change.action])}</span>
        <Show when={change.previousText}>{(previous) => <s class="agent-step-memory-previous">{previous()}</s>}</Show>
        {change.action === "forgotten" ? <s>{change.text}</s> : <span>{change.text}</span>}
      </span>
    );
  }
  const shown = step.kind === "thinking" ? step.text : text.sourceText(step.text);
  return <span class={["agent-step-text", { "agent-activity-label": newest }]}>{shown}</span>;
}

function StepIcon(props: { kind: AgentStep["kind"] }) {
  return (
    <>
      {props.kind === "thinking" ? (
        <Sparkles class="agent-step-icon" aria-hidden="true" />
      ) : props.kind === "progress" ? (
        <Puzzle class="agent-step-icon" aria-hidden="true" />
      ) : (
        <Brain class="agent-step-icon" aria-hidden="true" />
      )}
    </>
  );
}

/** The one-line summary of a finished turn's steps: "9 steps · Memory: 2 saved and 1 forgotten". */
function stepsSummary(steps: readonly AgentStep[], text: TextValue): string {
  const work = steps.filter((step) => step.kind === "thinking" || step.kind === "progress").length;
  const changes = steps.flatMap((step) => (step.kind === "memory" ? [step.change] : []));
  const counts = countConversationMemoryChanges(changes);
  const memory = text.format.list(
    [
      counts.saved ? text.t("chat.steps.memorySaved", { count: counts.saved }) : null,
      counts.updated ? text.t("chat.steps.memoryUpdated", { count: counts.updated }) : null,
      counts.forgotten ? text.t("chat.steps.memoryForgotten", { count: counts.forgotten }) : null,
      counts.notChanged ? text.t("chat.steps.memoryNotChanged", { count: counts.notChanged }) : null,
    ].filter((part): part is string => part !== null),
  );
  const fallback = steps.find((step) => step.kind === "memory-summary");
  return [
    work > 0 ? text.t("chat.steps.count", { count: work }) : null,
    changes.length > 0 ? text.t("chat.steps.memory", { changes: memory }) : null,
    fallback?.kind === "memory-summary" ? text.sourceText(fallback.text) : null,
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");
}

/** The trace of a turn, which its steps row opens in a dialog. */
export interface AgentStepsTrace {
  /** Read only while the dialog is open. */
  spans: () => readonly TraceSpan[];
  keyboard: TraceKeyboard;
  /** The spans that are not steps of the list but that the chat can show, such as subagents. */
  canSelectSpan?: (id: string) => boolean;
  onSelectSpan?: (id: string) => void;
}

/** The facts of a finished turn that its steps row shows. */
export interface AgentStepsFacts {
  durationMs: number;
  /** The steps and subagents that failed. */
  failed: number;
}

/**
 * The steps of a finished turn, above its answer: a closed summary row that opens the list, or the
 * trace when the turn has one. The row looks like the header of the subagents above it. The "Show
 * agent steps" setting opens the list at first. An open list, also one that a step picked in the
 * trace opened, closes from the row.
 */
export function AgentStepsDisclosure(props: {
  steps: readonly AgentStep[];
  defaultOpen: boolean;
  trace?: AgentStepsTrace | undefined;
  facts?: AgentStepsFacts | undefined;
}) {
  const text = useText();
  const duration = useDuration();
  /** Whole seconds, rounded as the trace rounds the turn, so that the row and the trace agree. */
  const turnTime = (ms: number) => duration(Math.round(ms / 1_000) * 1_000);
  const panelId = createUniqueId();
  const [choice, setChoice] = createSignal<boolean>();
  // The time the trace opened: a finished turn does not move, so its "now" stays at that time.
  const [traceOpenedAt, setTraceOpenedAt] = createSignal<number | null>(null);
  // A long chat has a row for each turn, so a row builds its trace dialog when it first opens.
  const [traceUsed, setTraceUsed] = createSignal(false);
  const open = () => choice() ?? props.defaultOpen;
  // The step that the user picked in the trace. A new object each time scrolls to it again.
  const [focus, setFocus] = createSignal<{ id: string } | null>(null);
  const isStep = (id: string) => props.steps.some((step) => step.id === id);
  const canSelectSpan = (id: string) => isStep(id) || (props.trace?.canSelectSpan?.(id) ?? false);
  /** Closes the trace and shows the step in the list, or lets the chat show it. */
  const selectSpan = (id: string) => {
    setTraceOpenedAt(null);
    if (!isStep(id)) {
      props.trace?.onSelectSpan?.(id);
      return;
    }
    setChoice(true);
    setFocus({ id });
  };
  /** The row opens the trace, unless it has none or its list is open. */
  const opensTrace = () => props.trace !== undefined && !open();
  const expanded = () => {
    if (opensTrace()) return undefined;
    return open() ? "true" : "false";
  };
  const controls = () => {
    if (!open()) return undefined;
    return panelId;
  };
  const popup = () => {
    if (opensTrace()) return "dialog";
    return undefined;
  };
  const activate = () => {
    if (opensTrace()) {
      setTraceUsed(true);
      setTraceOpenedAt(Date.now());
      return;
    }
    setFocus(null);
    setChoice(!open());
  };
  return (
    <div class="agent-steps" data-open={open() ? "" : undefined}>
      <Button
        type="button"
        variant="ghost"
        class="agent-steps-header"
        aria-expanded={expanded()}
        aria-controls={controls()}
        aria-haspopup={popup()}
        onClick={activate}
      >
        <span class="agent-steps-summary">{stepsSummary(props.steps, text)}</span>
        <Show when={props.facts}>
          {(facts) => (
            <>
              <Show when={facts().failed > 0}>
                <Badge class="agent-steps-failed">{text.t("chat.steps.failed", { count: facts().failed })}</Badge>
              </Show>
              <span class="agent-steps-duration">{turnTime(facts().durationMs)}</span>
            </>
          )}
        </Show>
        <ChevronRight class="agent-steps-chevron" aria-hidden="true" />
      </Button>
      <Show when={traceUsed() && props.trace}>
        {(trace) => {
          // The waterfall reads its spans many times for each change; this builds them once.
          const spans = createMemo(() => trace().spans());
          return (
            <TraceWaterfallDialog
              open={traceOpenedAt() !== null}
              onOpenChange={(next) => {
                if (!next) setTraceOpenedAt(null);
              }}
              spans={spans()}
              now={traceOpenedAt() ?? 0}
              keyboard={trace().keyboard}
              canSelectSpan={canSelectSpan}
              onSelectSpan={selectSpan}
            />
          );
        }}
      </Show>
      {/* A long chat has a row for each turn, so a closed row builds no list. */}
      <Show when={open()}>
        <div class="agent-steps-panel">
          <AgentStepList id={panelId} steps={props.steps} live={false} focus={focus()} />
        </div>
      </Show>
    </div>
  );
}
