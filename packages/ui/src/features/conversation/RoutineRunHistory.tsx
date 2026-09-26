import { isRoutineRun, type RoutineRunFields } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { Button, Check, CirclePause, Clock3, TriangleAlert, X } from "@openbot/ui";
import { For, Show } from "solid-js";
import { type TextValue, useText } from "../../text";

interface RoutineRunHistoryProps {
  runs: RoutineRunFields[];
  onOpenRun?: (messageId: string) => void;
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
  const { t } = text;
  const visibleRuns = () => props.runs.slice(0, 10);
  return (
    <section class="agent-routine-history" aria-labelledby="routine-history-heading">
      <h3 id="routine-history-heading">{t("routine.history.title")}</h3>
      <Show when={visibleRuns().length > 0} fallback={<p class="agent-routines-empty">{t("routine.history.empty")}</p>}>
        <div class="agent-routine-run-list">
          <For each={visibleRuns()}>
            {(run) => {
              const label = () =>
                run.kind === "manual"
                  ? t("routine.history.manualRun", { time: formatRoutineRunTime(run.scheduledFor, text) })
                  : formatRoutineRunTime(run.scheduledFor, text);
              const content = (
                <>
                  <span>{label()}</span>
                  <RoutineRunStatus status={run.status} />
                </>
              );
              return (
                <Show
                  when={props.onOpenRun ? runMessageId(run) : null}
                  fallback={<div class="agent-routine-run-row">{content}</div>}
                >
                  {(messageId) => (
                    <Button
                      variant="ghost"
                      type="button"
                      class="agent-routine-run-row agent-routine-run-link"
                      aria-label={t("routine.history.openRun", { run: label() })}
                      onClick={() => props.onOpenRun?.(messageId())}
                    >
                      {content}
                    </Button>
                  )}
                </Show>
              );
            }}
          </For>
        </div>
      </Show>
    </section>
  );
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

const RUN_STATUS_LABEL = {
  queued: "routine.runStatus.queued",
  running: "routine.runStatus.running",
  "needs-attention": "routine.runStatus.needsAttention",
  succeeded: "routine.runStatus.succeeded",
  failed: "routine.runStatus.failed",
  interrupted: "routine.runStatus.interrupted",
  cancelled: "routine.runStatus.cancelled",
} as const satisfies Record<RoutineRunFields["status"], AppTextKey>;
