import { Button, ChevronDown } from "@openbot/ui";
import { createMemo, createSignal, createUniqueId, For, Show, untrack } from "solid-js";
import { createDigitRoll } from "../../digit-roll";
import { useText } from "../../text";

export type TaskListItemState = "pending" | "active" | "done";
/** The glyph states. `failed` is for work that another agent could not finish. */
export type TaskMarkState = TaskListItemState | "failed";

export interface TaskListItem {
  id: string;
  label: string;
  state: TaskListItemState;
  /** The part of an active task that is complete, from 0 to 1. Other states ignore it. */
  progress?: number | undefined;
}

export interface TaskListProps {
  items: readonly TaskListItem[];
  /** The header text. The default is "Tasks". */
  title?: string;
  /** The list starts collapsed when this is false. */
  defaultOpen?: boolean;
  class?: string;
}

const STATE_LABEL = {
  pending: "chat.taskList.state.pending",
  active: "chat.taskList.state.active",
  done: "chat.taskList.state.done",
} as const;

// The ring radius of the 16-unit glyph box, inside a 1.5-unit stroke.
const RING_RADIUS = 7.25;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/**
 * The chat block of a plan an agent works through. The header shows how many tasks are done and
 * opens or closes the list. Each task shows its state, and an active task can show its progress.
 */
export function TaskList(props: TaskListProps) {
  const { t } = useText();
  const panelId = createUniqueId();
  const [open, setOpen] = createSignal(untrack(() => props.defaultOpen ?? true));
  const total = () => props.items.length;
  const done = () => props.items.filter((item) => item.state === "done").length;
  const active = () => props.items.find((item) => item.state === "active");
  return (
    <section class={["task-list", props.class]} data-open={open() ? "" : undefined}>
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
                  {/* A progress of 0 still shows, so the badge does not flicker when a task starts. */}
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
  /** The work that runs now. A closed list names it in place of the title. */
  active?: { id: string; label: string } | undefined;
  /** The count for assistive technology, such as "2 of 5 tasks done". */
  summary: string;
  /** The count that shows. The default is "{done}/{total}". */
  count?: string;
}

/**
 * The header of a task list card: the progress ring, the title, the count and the chevron. The
 * whole row opens or closes the panel. The waiting block uses the same header.
 */
export function TaskListHeader(props: TaskListHeaderProps) {
  const { t } = useText();
  const complete = () => props.total > 0 && props.done === props.total;
  // The last active work stays as the header text while it fades out, so the fade is not empty.
  let lastActive: { id: string; label: string } | undefined;
  const headerTask = createMemo(() => {
    lastActive = props.active ?? lastActive;
    return lastActive;
  });
  // A closed list names the work that runs, so the person can see the work go on.
  const showTask = () => !props.open && props.active !== undefined;
  return (
    <Button
      variant="ghost"
      type="button"
      class="task-list-header"
      aria-expanded={props.open ? "true" : "false"}
      aria-controls={props.panelId}
      onClick={() => props.onToggle()}
    >
      <span class="task-list-summary-glyph" aria-hidden="true">
        <Show
          when={complete()}
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
          <TaskMark state="done" />
        </Show>
      </span>
      <span class="task-list-title" data-showing={showTask() ? "task" : "title"}>
        <span class="task-list-title-layer task-list-title-name" aria-hidden={showTask() ? "true" : undefined}>
          {props.title}
        </span>
        <span class="task-list-title-layer task-list-title-task" aria-hidden={showTask() ? undefined : "true"}>
          {/* Keyed by task, so the next task enters with its own blur instead of replacing the text. */}
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

/**
 * The percent of an active task. The digits roll to each settled value, as in the update island;
 * assistive technology reads the live value.
 */
function TaskProgress(props: { value: number }) {
  const { format } = useText();
  const roll = createDigitRoll(() => Math.round(props.value * 100));
  const characters = () => format.percent(roll.displayed() / 100).split("");
  // The last two digits trail the others, so the number that changes most lands last.
  const stagger = (index: number) => {
    const digits = characters().flatMap((character, position) => (isDigit(character) ? [position] : []));
    if (index === digits.at(-1)) return "2";
    if (index === digits.at(-2)) return "1";
    return undefined;
  };
  return (
    <span class="task-list-item-progress">
      <span ref={roll.ref} class="task-list-item-progress-digits t-digit-group" aria-hidden="true">
        {/* Only the digits roll. The percent sign and the spaces of the locale stay still. */}
        <For each={characters()} keyed={false}>
          {(character, index) => (
            <span
              class={isDigit(character()) ? "t-digit" : undefined}
              data-stagger={isDigit(character()) ? stagger(index) : undefined}
            >
              {character()}
            </span>
          )}
        </For>
      </span>
      <span class="sr-only">{format.percent(props.value, { maximumFractionDigits: 0 })}</span>
    </span>
  );
}

function isDigit(character: string) {
  return /\d/u.test(character);
}

/**
 * One glyph for all states, so a change of state animates in place: a dotted ring while pending,
 * a turning arc while active, a filled disc with a check when done, and a cross when failed.
 */
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
