import {
  isRoutineRun,
  ROUTINE_MISSED_COUNT_LIMIT,
  type RoutineMissedRuns,
  type RoutineResultDelivery,
  type RoutineResultDeliveryReason,
  type RoutineResultDeliveryStatus,
  type RoutineRunFields,
} from "@openbot/contracts/ipc";
import type { EventActivity, EventRoutineRef, ListEventActivityInput } from "@openbot/contracts/ipc-events";
import type { AppMessages, AppTextKey } from "@openbot/i18n";
import { Button, Check, CirclePause, Clock3, Minus, Text, TriangleAlert, X } from "@openbot/ui";
import { createEffect, createSignal, createUniqueId, For, Match, Show, Switch, untrack } from "solid-js";
import { type TextValue, useText } from "../../text";

/** The webhook activity of an event routine. Its ignored requests join the runs. */
interface RoutineHistoryActivity {
  api: { listActivity: (input: ListEventActivityInput) => Promise<EventActivity[]> };
  routine: EventRoutineRef;
}

/** Where each run's answer went outside OpenBot. Only an agent routine on this computer has it. */
interface RoutineHistoryDeliveries {
  items: RoutineResultDelivery[];
  onResend: (runId: string) => Promise<void>;
}

interface RoutineRunHistoryProps {
  runs: RoutineRunFields[];
  onOpenRun?: ((messageId: string) => void) | undefined;
  activity?: RoutineHistoryActivity | undefined;
  deliveries?: RoutineHistoryDeliveries | undefined;
}

type HistoryEntry =
  | { kind: "run"; at: string; run: RoutineRunFields }
  | { kind: "skipped"; at: string; missed: RoutineMissedRuns }
  | { kind: "ignored"; at: string; item: EventActivity };

const VISIBLE_ENTRIES = 10;
const ACTIVITY_LIMIT = 50;
/** A scheduled run that started this long after its time ran late: OpenBot was closed or asleep. */
const LATE_RUN_MS = 60_000;

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
      if (current !== request) return;
      setActivity(rows);
      setError(null);
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

  const resendDelivery = async (runId: string) => {
    await props.deliveries?.onResend(runId);
  };

  const entries = (): HistoryEntry[] =>
    [
      ...props.runs.map(
        (run): HistoryEntry =>
          run.missed
            ? { kind: "skipped", at: run.scheduledFor, missed: run.missed }
            : { kind: "run", at: run.scheduledFor, run },
      ),
      // A started request already shows as its run. The history adds only the requests that did not start a run.
      ...activity()
        .filter((item) => item.status === "ignored")
        .map((item): HistoryEntry => ({ kind: "ignored", at: item.occurredAt, item })),
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
                  {(run) => (
                    <Show
                      when={props.deliveries?.items.find((delivery) => delivery.runId === run().id)}
                      fallback={<RunRow run={run()} onOpenRun={props.onOpenRun} />}
                    >
                      {(delivery) => (
                        <div class="agent-routine-run-entry">
                          <RunRow run={run()} onOpenRun={props.onOpenRun} />
                          <DeliveryRow delivery={delivery()} onResend={resendDelivery} />
                        </div>
                      )}
                    </Show>
                  )}
                </Match>
                <Match when={entry.kind === "skipped" && entry}>
                  {(skipped) => (
                    <div class="agent-routine-run-row">
                      <span class="agent-routine-run-text">
                        <span>{formatRoutineRunTime(skipped().at, text, skipped().missed.until)}</span>
                        <span class="agent-routine-run-note">{skippedNote(skipped().missed, text)}</span>
                      </span>
                      {/* The note already says "Skipped", so the icon has no label of its own. */}
                      <span class="agent-routine-run-icon agent-routine-run-icon-ignored" aria-hidden="true">
                        <Minus />
                      </span>
                    </div>
                  )}
                </Match>
                <Match when={entry.kind === "ignored" && entry.item}>
                  {(item) => (
                    <div class="agent-routine-run-row">
                      <span class="agent-routine-run-text">
                        <span>{formatRoutineRunTime(item().occurredAt, text)}</span>
                        <span class="agent-routine-run-note">{ignoredNote(item(), text)}</span>
                      </span>
                      {/* The note already says "Ignored", so the icon has no label of its own. */}
                      <span class="agent-routine-run-icon agent-routine-run-icon-ignored" aria-hidden="true">
                        <Minus />
                      </span>
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

function RunRow(props: { run: RoutineRunFields; onOpenRun?: ((messageId: string) => void) | undefined }) {
  const text = useText();
  const { t } = text;
  const label = () => {
    const time = formatRoutineRunTime(props.run.scheduledFor, text);
    if (props.run.kind !== "manual") return time;
    if (props.run.source === "script") return t("routine.history.scriptRun", { time });
    if (props.run.source === "webhook") return t("routine.history.webhookRun", { time });
    return t("routine.history.manualRun", { time });
  };
  const late = () => lateStart(props.run);
  const failure = () => (props.run.status === "failed" && props.run.error ? text.sourceText(props.run.error) : null);
  // The link's label replaces its text, so a screen reader gets the reason as the description.
  const reasonId = createUniqueId();
  const content = (
    <>
      <Show when={late() || failure()} fallback={<span>{label()}</span>}>
        <span class="agent-routine-run-text">
          <span>{label()}</span>
          <Show when={late()}>
            {(startedAt) => (
              <span class="agent-routine-run-note">
                {t("routine.history.ranLate", { time: formatLateStart(props.run.scheduledFor, startedAt(), text) })}
              </span>
            )}
          </Show>
          <Show when={failure()}>
            {(reason) => (
              <span id={reasonId} class="agent-routine-run-note" title={reason()}>
                {reason()}
              </span>
            )}
          </Show>
        </span>
      </Show>
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
          aria-describedby={failure() ? reasonId : undefined}
          data-cuelume-tap="navigate"
          onClick={() => props.onOpenRun?.(messageId())}
        >
          {content}
        </Button>
      )}
    </Show>
  );
}

/**
 * The delivery's status is not the run's: a run gets one when its agent answered, also a run that
 * failed. A delivery that ended without a sure post can go again; a sent one cannot, so a click does
 * not post it twice.
 */
function DeliveryRow(props: { delivery: RoutineResultDelivery; onResend: (runId: string) => Promise<void> }) {
  const { t, errorMessage } = useText();
  const [sending, setSending] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const note = () => {
    const status = t(DELIVERY_STATUS_LABEL[props.delivery.status], { place: props.delivery.destination.placeName });
    const reason = props.delivery.reason;
    return reason ? t("routine.delivery.withReason", { status, why: t(DELIVERY_REASON_LABEL[reason]) }) : status;
  };
  const canResend = () => props.delivery.status === "failed" || props.delivery.status === "uncertain";

  async function resend(): Promise<void> {
    setSending(true);
    setError(null);
    try {
      await props.onResend(props.delivery.runId);
    } catch (cause) {
      setError(errorMessage(cause, t("routine.delivery.resendFailed")));
    } finally {
      setSending(false);
    }
  }

  return (
    <div class="agent-routine-delivery-row">
      <span class="agent-routine-run-text">
        <span class={`agent-routine-delivery-note agent-routine-delivery-${props.delivery.status}`}>{note()}</span>
        <Show when={error()}>
          {(message) => (
            <Text variant="caption" tone="danger" role="alert">
              {message()}
            </Text>
          )}
        </Show>
      </span>
      <Show when={canResend()}>
        <Button
          variant="ghost"
          type="button"
          size="sm"
          loading={sending()}
          loadingLabel={t("routine.delivery.resending")}
          onClick={() => void resend()}
        >
          {t("routine.delivery.resend")}
        </Button>
      </Show>
    </div>
  );
}

/** When a scheduled run started late, the time it started. The run is created as it starts. */
function lateStart(run: RoutineRunFields): Date | null {
  if (run.kind !== "scheduled") return null;
  const startedAt = new Date(run.createdAt);
  return startedAt.getTime() - Date.parse(run.scheduledFor) >= LATE_RUN_MS ? startedAt : null;
}

function formatLateStart(scheduledFor: string, startedAt: Date, text: Pick<TextValue, "t" | "format">): string {
  return sameCalendarDay(new Date(scheduledFor), startedAt)
    ? text.format.date(startedAt, { hour: "numeric", minute: "2-digit" })
    : formatRoutineRunTime(startedAt.toISOString(), text);
}

function skippedNote(missed: RoutineMissedRuns, text: Pick<TextValue, "t">): string {
  return missed.count > ROUTINE_MISSED_COUNT_LIMIT
    ? text.t("routine.history.skippedMore", { count: ROUTINE_MISSED_COUNT_LIMIT })
    : text.t("routine.history.skipped", { count: missed.count });
}

function ignoredNote(item: EventActivity, text: Pick<TextValue, "t">): string {
  return text.t(item.reason ? IGNORED_REASON_LABELS[item.reason] : "routine.history.ignored");
}

function RoutineRunStatus(props: { status: RoutineRunFields["status"] }) {
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
    </span>
  );
}

/** `until` makes a range. A range within one day names the day once. */
function formatRoutineRunTime(value: string, text: Pick<TextValue, "t" | "format">, until?: string | null): string {
  const date = new Date(value);
  const end = until ? new Date(until) : null;
  if (until && end && !sameCalendarDay(date, end)) {
    return text.t("routine.history.range", {
      from: formatRoutineRunTime(value, text),
      until: formatRoutineRunTime(until, text),
    });
  }
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const clock = (moment: Date) => text.format.date(moment, { hour: "numeric", minute: "2-digit" });
  const time = end ? text.t("routine.history.range", { from: clock(date), until: clock(end) }) : clock(date);
  if (sameCalendarDay(date, today)) return text.t("routine.history.today", { time });
  if (sameCalendarDay(date, yesterday)) return text.t("routine.history.yesterday", { time });
  const full = text.format.date(date, { dateStyle: "medium", timeStyle: "short" });
  return end ? text.t("routine.history.range", { from: full, until: clock(end) }) : full;
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
} as const satisfies Record<RoutineRunFields["status"], AppTextKey>;

const DELIVERY_STATUS_LABEL = {
  pending: "routine.delivery.pending",
  sending: "routine.delivery.sending",
  sent: "routine.delivery.sent",
  failed: "routine.delivery.failed",
  uncertain: "routine.delivery.uncertain",
} as const satisfies Record<RoutineResultDeliveryStatus, keyof AppMessages>;

const DELIVERY_REASON_LABEL = {
  expired: "routine.delivery.reason.expired",
  "connection-gone": "routine.delivery.reason.connectionGone",
  refused: "routine.delivery.reason.refused",
  "send-failed": "routine.delivery.reason.sendFailed",
  restart: "routine.delivery.reason.restart",
  stopped: "routine.delivery.reason.stopped",
} as const satisfies Record<RoutineResultDeliveryReason, AppTextKey>;
