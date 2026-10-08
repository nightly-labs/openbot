/**
 * What a routine does over time, at a glance: the week ahead as seven day columns with a tick at
 * each time it fires, and its last runs as a row of status dots. The card and the run panel show
 * the same two pictures at two sizes.
 */

import { For, Show } from "solid-js";
import { useText } from "../../text";
import type { DiagramRoutineRun, DiagramRunStatus, DiagramStepStatus } from "./diagram-model";
import { DIAGRAM_RUN_STATUS_KEY } from "./diagram-text";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_DAYS = 7;

/** A routine run reuses the step icons: a cancelled run reads as a skipped step. */
export function diagramRunStepStatus(status: DiagramRunStatus): DiagramStepStatus {
  return status === "cancelled" ? "skipped" : status;
}

function startOfDay(date: Date): Date {
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  return day;
}

export function DiagramRoutineWeek(props: { upcomingRuns: string[]; now: Date; size: "card" | "panel" }) {
  const { t, format } = useText();
  const days = () => {
    const first = startOfDay(props.now).getTime();
    return Array.from({ length: WEEK_DAYS }, (_, index) => {
      const start = first + index * DAY_MS;
      const date = new Date(start);
      const ticks = props.upcomingRuns
        .map((value) => Date.parse(value))
        .filter((at) => at >= start && at < start + DAY_MS)
        .map((at) => ((at - start) / DAY_MS) * 100);
      return { date, ticks, today: index === 0, weekend: date.getDay() === 0 || date.getDay() === 6 };
    });
  };
  const count = () => days().reduce((total, day) => total + day.ticks.length, 0);
  return (
    <div
      class="diagram-routine-week"
      data-size={props.size}
      role="img"
      aria-label={t("diagram.routine.weekLabel", { count: count() })}
    >
      <For each={days()}>
        {(day) => (
          <div
            class="diagram-routine-day"
            data-today={day.today ? "" : undefined}
            data-weekend={day.weekend ? "" : undefined}
          >
            <span class="diagram-routine-day-track">
              <For each={day.ticks}>
                {(tick) => <span class="diagram-routine-tick" style={{ "--diagram-tick-at": `${tick}%` }} />}
              </For>
            </span>
            <span class="diagram-routine-day-name" aria-hidden="true">
              {format.date(day.date, { weekday: props.size === "card" ? "narrow" : "short" })}
            </span>
          </div>
        )}
      </For>
    </div>
  );
}

export function DiagramRoutineRunDots(props: { runs: DiagramRoutineRun[]; limit: number }) {
  const { t, format } = useText();
  // Oldest on the left, so the row reads forward in time to the newest run.
  const runs = () => props.runs.slice(0, props.limit).reverse();
  return (
    <Show when={runs().length > 0}>
      <ul class="diagram-routine-dots" aria-label={t("diagram.routine.recent")}>
        <For each={runs()}>
          {(run) => {
            const label = () =>
              t("diagram.routine.runLabel", {
                status: t(DIAGRAM_RUN_STATUS_KEY[run.status]),
                time: format.date(new Date(run.startedAt), {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                }),
              });
            return (
              <li class="diagram-routine-dot" data-status={run.status} title={label()}>
                <span class="sr-only">{label()}</span>
              </li>
            );
          }}
        </For>
      </ul>
    </Show>
  );
}
