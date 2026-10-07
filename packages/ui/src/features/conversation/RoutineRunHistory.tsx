import { isRoutineRun, type RoutineRunFields } from "@openbot/contracts/ipc";
import type { EventActivity, EventRoutineRef, ListEventActivityInput } from "@openbot/contracts/ipc-events";
import type { AppTextKey } from "@openbot/i18n";
import { Button, Check, CirclePause, Clock3, Minus, Text, TriangleAlert, X } from "@openbot/ui";
import { createEffect, createSignal, For, Match, Show, Switch, untrack } from "solid-js";
import { type TextValue, useText } from "../../text";

/** The webhook activity of an event routine. Its ignored requests join the runs. */
export interface RoutineHistoryActivity {
  api: { listActivity: (input: ListEventActivityInput) => Promise<EventActivity[]> };
  routine: EventRoutineRef;
}

interface RoutineRunHistoryProps {
  runs: RoutineRunFields[];
  onOpenRun?: (messageId: string) => void;
  activity?: RoutineHistoryActivity;
}

type HistoryEntry =
  | { kind: "run"; at: string; run: RoutineRunFields }
  | { kind: "ignored"; at: string; item: EventActivity };

const VISIBLE_ENTRIES = 10;
const ACTIVITY_LIMIT = 50;

/** A started request already shows as its run. The history adds only the requests that did not start a run. */
function activityEntry(item: EventActivity): HistoryEntry | null {
  return item.status === "ignored" ? { kind: "ignored", at: item.occurredAt, item } : null;
}

/**
 * Only an agent run names a message the user can jump to: its mailbox delivery. A channel run
 * fires into the channel everybody is already reading, so its rows stay plain.
 */
function runMessageId(run: RoutineRunFields): string | null {
  return isRoutineRun(run) ? run.deliveryId : null;
}

export function RoutineRunHistory(props: RoutineRunHistoryProps) {
  const text = useText();
  const { t, errorMessage } = text;
  const [activity, setActivity] = createSignal<EventActivity[]>([]);
  const [error, setError] = createSignal<string | null>(null);
  let request = 0;

  async function loadActivity(): Promise<void> {
    const source = props.activity;
    const current = ++request;
    if (!source) {
      setActivity([]);
      return;
    }
    try {
      const rows = await source.api.listActivity({
        owner: source.routine.owner,
        routineId: source.routine.id,
        limit: ACTIVITY_LIMIT,
      });
      if (current === request) setActivity(rows);
    } catch (cause) {
      if (current === request) setError(errorMessage(cause, t("routine.history.activityFailed")));
    }
  }

  // A run changes the list, so the activity loads again with it. There is no refresh button.
  createEffect(
    () => [props.activity?.routine.id, props.activity?.routine.owner, props.runs] as const,
    ([routineId], previous) => {
      if (routineId !== previous?.[0]) {
        setActivity([]);
        setError(null);
      }
      void untrack(loadActivity);
    },
  );

  const entries = (): HistoryEntry[] =>
    [
      ...props.runs.map((run): HistoryEntry => ({ kind: "run", at: run.scheduledFor, run })),
      ...activity().flatMap((item) => activityEntry(item) ?? []),
    ]
      .sort((left, right) => Date.parse(right.at) - Date.parse(left.at))
      .slice(0, VISIBLE_ENTRIES);

  return (
    <section class="agent-routine-history" aria-labelledby="routine-history-heading">
      <h3 id="routine-history-heading">{t("routine.history.title")}</h3>
      <Show when={error()}>
        {(message) => (
          <Text variant="caption" tone="danger" role="alert" class="agent-routine-history-error">
            {message()}
          </Text>
        )}
      </Show>
      <Show when={entries().length > 0} fallback={<p class="agent-routines-empty">{t("routine.history.empty")}</p>}>
        <div class="agent-routine-run-list">
          <For each={entries()}>
            {(entry) => (
              <Switch>
                <Match when={entry.kind === "run" && entry.run}>
                  {(run) => <RunRow run={run()} onOpenRun={props.onOpenRun} />}
                </Match>
                <Match when={entry.kind === "ignored" && entry.item}>
                  {(item) => (
                    <div class="agent-routine-run-row">
                      <span class="agent-routine-run-text">
                        <span>{formatRoutineRunTime(item().occurredAt, text)}</span>
                        <span class="agent-routine-run-note">{ignoredNote(item(), text)}</span>
                      </span>
                      <RoutineRunStatus status="ignored" />
                    </div>
                  )}
                </Match>
              </Switch>
            )}
          </For>
        </div>
      </Show>
    </section>
  );
}

function RunRow(props: { run: RoutineRunFields; onOpenRun?: (messageId: string) => void }) {
  const text = useText();
  const { t } = text;
  const label = () =>
    props.run.kind === "manual"
      ? t("routine.history.manualRun", { time: formatRoutineRunTime(props.run.scheduledFor, text) })
      : formatRoutineRunTime(props.run.scheduledFor, text);
  const content = (
    <>
      <span>{label()}</span>
      <RoutineRunStatus status={props.run.status} />
    </>
  );
  return (
    <Show
      when={props.onOpenRun ? runMessageId(props.run) : null}
      fallback={<div class="agent-routine-run-row">{content}</div>}
    >
      {(messageId) => (
        <Button
          variant="ghost"
          type="button"
          class="agent-routine-run-row agent-routine-run-link"
          aria-label={t("routine.history.openRun", { run: label() })}
          data-cuelume-tap="navigate"
          onClick={() => props.onOpenRun?.(messageId())}
        >
          {content}
        </Button>
      )}
    </Show>
  );
}

function ignoredNote(item: EventActivity, text: Pick<TextValue, "t">): string {
  return text.t(item.reason ? IGNORED_REASON_LABELS[item.reason] : "routine.history.ignored");
}

type HistoryStatus = RoutineRunFields["status"] | "ignored";

function RoutineRunStatus(props: { status: HistoryStatus }) {
  const { t } = useText();
  const label = () => t(RUN_STATUS_LABEL[props.status]);
  return (
    <span
      class={`agent-routine-run-icon agent-routine-run-icon-${props.status}`}
      role="img"
      aria-label={label()}
      title={label()}
    >
      <Show when={props.status === "succeeded"}>
        <Check aria-hidden="true" />
      </Show>
      <Show when={props.status === "failed"}>
        <X aria-hidden="true" />
      </Show>
      <Show when={props.status === "needs-attention"}>
        <TriangleAlert aria-hidden="true" />
      </Show>
      <Show when={props.status === "queued" || props.status === "running"}>
        <Clock3 aria-hidden="true" />
      </Show>
      <Show when={props.status === "interrupted" || props.status === "cancelled"}>
        <CirclePause aria-hidden="true" />
      </Show>
      <Show when={props.status === "ignored"}>
        <Minus aria-hidden="true" />
      </Show>
    </span>
  );
}

function formatRoutineRunTime(value: string, text: Pick<TextValue, "t" | "format">): string {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const time = text.format.date(date, { hour: "numeric", minute: "2-digit" });
  if (sameCalendarDay(date, today)) return text.t("routine.history.today", { time });
  if (sameCalendarDay(date, yesterday)) return text.t("routine.history.yesterday", { time });
  return text.format.date(date, { dateStyle: "medium", timeStyle: "short" });
}

function sameCalendarDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

const IGNORED_REASON_LABELS = {
  "event-type": "routine.history.ignored.eventType",
  filter: "routine.history.ignored.filter",
  inactive: "routine.history.ignored.inactive",
} as const satisfies Record<NonNullable<EventActivity["reason"]>, AppTextKey>;

const RUN_STATUS_LABEL = {
  queued: "routine.runStatus.queued",
  running: "routine.runStatus.running",
  "needs-attention": "routine.runStatus.needsAttention",
  succeeded: "routine.runStatus.succeeded",
  failed: "routine.runStatus.failed",
  interrupted: "routine.runStatus.interrupted",
  cancelled: "routine.runStatus.cancelled",
  ignored: "routine.history.ignored",
} as const satisfies Record<HistoryStatus, AppTextKey>;
