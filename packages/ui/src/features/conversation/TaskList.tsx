import { Button, ChevronDown } from "@openbot/ui";
import { createMemo, createSignal, createUniqueId, For, onSettled, Show, untrack } from "solid-js";
import { createDigitRoll } from "../../digit-roll";
import { DigitRuns } from "../../digit-runs";
import { useText } from "../../text";

export type TaskListItemState = "pending" | "active" | "done";
export type TaskMarkState = TaskListItemState | "failed";

export interface TaskListItem {
  id: string;
  label: string;
  state: TaskListItemState;
  progress?: number | undefined;
}

export interface TaskListProps {
  items: readonly TaskListItem[];
  title?: string;
  defaultOpen?: boolean;
  class?: string;
}

const STATE_LABEL = {
  pending: "chat.taskList.state.pending",
  active: "chat.taskList.state.active",
  done: "chat.taskList.state.done",
} as const;

const RING_RADIUS = 7.25;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

export function TaskList(props: TaskListProps) {
  const { t } = useText();
  const panelId = createUniqueId();
  const playState = createTaskListPlayState();
  const [open, setOpen] = createSignal(untrack(() => props.defaultOpen ?? true));
  const total = () => props.items.length;
  const done = () => props.items.filter((item) => item.state === "done").length;
  const active = () => props.items.find((item) => item.state === "active");
  return (
    <section
      style={{ "--task-list-play-state": playState() }}
      class={["task-list", props.class]}
      data-open={open() ? "" : undefined}
    >
      <TaskListHeader
        open={open()}
        onToggle={() => setOpen((value) => !value)}
        panelId={panelId}
        done={done()}
        total={total()}
        title={props.title ?? t("chat.taskList.title")}
        active={active()}
        summary={t("chat.taskList.summary", { done: done(), total: total() })}
      />
      <div id={panelId} class="task-list-panel" inert={open() ? undefined : true}>
        <ol class="task-list-items">
          <For each={props.items} keyed={(item) => item.id}>
            {(item, index) => {
              const percent = () => {
                const current = item();
                return current.state === "active" && current.progress !== undefined
                  ? Math.min(Math.max(current.progress, 0), 1)
                  : undefined;
              };
              return (
                <li class="task-list-item" data-state={item().state} style={{ "--task-list-index": index() }}>
                  <span class="task-list-item-mark" role="img" aria-label={t(STATE_LABEL[item().state])}>
                    <TaskMark state={item().state} />
                  </span>
                  <span class="task-list-item-label">
                    <span class="task-list-item-text">{item().label}</span>
                  </span>
                  <Show when={percent() !== undefined}>
                    <TaskProgress value={percent() ?? 0} />
                  </Show>
                </li>
              );
            }}
          </For>
        </ol>
      </div>
    </section>
  );
}

export interface TaskListHeaderProps {
  open: boolean;
  onToggle: () => void;
  panelId: string;
  done: number;
  total: number;
  title: string;
  active?: { id: string; label: string } | undefined;
  summary: string;
  count?: string;
  mark?: TaskMarkState | undefined;
}

export function TaskListHeader(props: TaskListHeaderProps) {
  const { t } = useText();
  const complete = () => props.total > 0 && props.done === props.total;
  const mark = () => props.mark ?? (complete() ? "done" : undefined);
  let lastActive: { id: string; label: string } | undefined;
  const headerTask = createMemo(() => {
    lastActive = props.active ?? lastActive;
    return lastActive;
  });
  const showTask = () => !props.open && props.active !== undefined;
  return (
    <Button
      variant="ghost"
      type="button"
      class="task-list-header"
      aria-expanded={props.open ? "true" : "false"}
      aria-controls={props.panelId}
      data-cuelume-tap={props.open ? "close" : "open"}
      onClick={() => props.onToggle()}
    >
      <span class="task-list-summary-glyph" aria-hidden="true">
        <Show
          when={mark()}
          fallback={
            <svg viewBox="0 0 16 16" fill="none" class="task-list-donut" aria-hidden="true">
              <circle class="task-list-donut-track" cx="8" cy="8" r={RING_RADIUS} />
              <circle
                class="task-list-donut-value"
                cx="8"
                cy="8"
                r={RING_RADIUS}
                stroke-dasharray={`${RING_LENGTH}`}
                stroke-dashoffset={`${RING_LENGTH * (1 - props.done / Math.max(props.total, 1))}`}
                transform="rotate(-90 8 8)"
              />
            </svg>
          }
        >
          {(state) => <TaskMark state={state()} />}
        </Show>
      </span>
      <span class="task-list-title" data-showing={showTask() ? "task" : "title"}>
        <span class="task-list-title-layer task-list-title-name" aria-hidden={showTask() ? "true" : undefined}>
          {props.title}
        </span>
        <span class="task-list-title-layer task-list-title-task" aria-hidden={showTask() ? undefined : "true"}>
          <For each={headerTask() ? [headerTask()] : []} keyed={(item) => item?.id}>
            {(item) => <span class="task-list-title-task-text">{item()?.label}</span>}
          </For>
        </span>
      </span>
      <span class="task-list-count" aria-hidden="true">
        {props.count ?? t("chat.taskList.count", { done: props.done, total: props.total })}
      </span>
      <span class="sr-only">{props.summary}</span>
      <ChevronDown class="task-list-chevron" aria-hidden="true" />
    </Button>
  );
}

function TaskProgress(props: { value: number }) {
  const { format } = useText();
  const roll = createDigitRoll(() => Math.round(props.value * 100));
  const characters = () => format.percent(roll.displayed() / 100).split("");
  const stagger = (index: number) => {
    const digits = characters().flatMap((character, position) => (isDigit(character) ? [position] : []));
    if (index === digits.at(-1)) return "2";
    if (index === digits.at(-2)) return "1";
    return undefined;
  };
  return (
    <span class="task-list-item-progress">
      <span ref={roll.ref} class="task-list-item-progress-digits t-digit-group" aria-hidden="true">
        <DigitRuns
          text={characters().join("")}
          digit={(character, index) => (
            <span
              class={isDigit(character()) ? "t-digit" : undefined}
              data-stagger={isDigit(character()) ? stagger(index()) : undefined}
            >
              {character()}
            </span>
          )}
        />
      </span>
      <span class="sr-only">{format.percent(props.value, { maximumFractionDigits: 0 })}</span>
    </span>
  );
}

function isDigit(character: string) {
  return /\d/u.test(character);
}

export function TaskMark(props: { state: TaskMarkState }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" class="task-list-mark" data-state={props.state} aria-hidden="true">
      <circle class="task-list-mark-pending" cx="8" cy="8" r={RING_RADIUS} />
      <circle class="task-list-mark-track" cx="8" cy="8" r={RING_RADIUS} />
      <circle class="task-list-mark-arc" cx="8" cy="8" r={RING_RADIUS} />
      <circle class="task-list-mark-fill" cx="8" cy="8" r="8" />
      <path class="task-list-mark-check" d="M4.8 8.4 7.04 10.8 11.52 6" pathLength="1" />
      <path class="task-list-mark-cross" d="M5.6 5.6 10.4 10.4M10.4 5.6 5.6 10.4" pathLength="1" />
    </svg>
  );
}

export function createTaskListPlayState() {
  const [playState, setPlayState] = createSignal(document.hidden ? "paused" : "running");
  onSettled(() => {
    const refresh = () => setPlayState(document.hidden ? "paused" : "running");
    refresh();
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  });
  return playState;
}
