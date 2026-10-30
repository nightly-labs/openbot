import type { AppTextKey } from "@openbot/i18n";
import { type CalendarDay, calendarDayDate, calendarMonthStart } from "@openbot/team-client/routine-calendar-dates";
import { Button, buttonVariants, Check, DropdownMenu } from "@openbot/ui";
import { createMemo, createSignal, For, Match, onSettled, Show, Switch } from "solid-js";
import { useText } from "../../text";
import { prefersReducedMotion } from "../../utils";
import { AgentAvatar } from "../agents/AgentAvatar";
import type { RoutineCalendarAgent } from "./RoutineCalendar";

/** One sample run on the faint month: where it lands, and the note it writes. */
interface SampleRun {
  name: AppTextKey;
  /** A wall-clock time, as "17:30". */
  time: string;
  /** The position of the agent in the agent list, so that each routine keeps one face. */
  agent: number;
  note: AppTextKey;
  row: number;
  column: number;
}

/** Runs land around the pitch, never behind it, and each one lands far from the last. */
const SAMPLE_RUNS: SampleRun[] = [
  {
    name: "routine.calendar.sample.pipelineReport",
    time: "17:30",
    agent: 2,
    note: "routine.calendar.sample.pipelineUp",
    row: 0,
    column: 3,
  },
  {
    name: "routine.calendar.sample.morningBrief",
    time: "07:00",
    agent: 0,
    note: "routine.calendar.sample.meetings",
    row: 2,
    column: 0,
  },
  {
    name: "routine.calendar.sample.inboxTriage",
    time: "09:00",
    agent: 0,
    note: "routine.calendar.sample.quietDay",
    row: 2,
    column: 6,
  },
  {
    name: "routine.calendar.sample.leadFollowUp",
    time: "14:00",
    agent: 2,
    note: "routine.calendar.sample.dealWon",
    row: 4,
    column: 1,
  },
  {
    name: "routine.calendar.sample.inboxTriage",
    time: "09:00",
    agent: 0,
    note: "routine.calendar.sample.inboxZero",
    row: 0,
    column: 6,
  },
  {
    name: "routine.calendar.sample.paperDigest",
    time: "08:30",
    agent: 1,
    note: "routine.calendar.sample.papers",
    row: 3,
    column: 0,
  },
  {
    name: "routine.calendar.sample.leadFollowUp",
    time: "14:00",
    agent: 2,
    note: "routine.calendar.sample.replies",
    row: 1,
    column: 1,
  },
];

/** A new run lands on each step. A run stays for `LIFE` steps, and its CSS animation is as long. */
const STEP_MS = 2200;
const LIFE = 3;
/** The handwriting speed and the pause before it starts, in milliseconds. */
const WRITE_START_MS = 900;
const MS_PER_CHAR = 55;
const LINE_GAP_MS = 160;

export interface RoutineCalendarEmptyProps {
  /** The whole weeks of the month that the calendar would show. */
  days: CalendarDay[];
  today: CalendarDay;
  agents: RoutineCalendarAgent[];
  onCreateRoutine?: ((agentId: string) => void) | undefined;
}

/**
 * The calendar before its first routine. A faint month is the backdrop: sample runs land on it one
 * at a time, and each one writes a short note of what it did. Nothing in the backdrop can be opened,
 * and a reader hears only the pitch.
 */
export function RoutineCalendarEmpty(props: RoutineCalendarEmptyProps) {
  const { t } = useText();
  const [step, setStep] = createSignal(0);
  const [still, setStill] = createSignal(false);
  onSettled(() => {
    // Less motion keeps one frame with `LIFE` runs and their notes.
    if (prefersReducedMotion()) {
      setStill(true);
      setStep(LIFE - 1);
      return;
    }
    const timer = window.setInterval(() => setStep((value) => value + 1), STEP_MS);
    return () => window.clearInterval(timer);
  });

  const title = () => {
    const marker = "\u0000";
    const [before = "", after = ""] = t("routine.calendar.emptyTitle", { done: marker }).split(marker);
    return { before, after };
  };

  return (
    <div class="routine-planner-empty" data-still={still() ? "" : undefined}>
      <RoutineCalendarEmptyBoard days={props.days} today={props.today} agents={props.agents} step={step()} />
      <div class="routine-planner-empty-pitch">
        <h3 class="routine-planner-empty-title">
          <span class="routine-planner-empty-lead">{t("routine.calendar.emptyLead")}</span>
          <span>
            {title().before}
            <span class="routine-planner-hand routine-planner-empty-done">{t("routine.calendar.emptyDone")}</span>
            {title().after}
          </span>
        </h3>
        <p class="routine-planner-empty-lines">
          <span>{t("routine.calendar.emptySchedule")}</span>
          <span>{t("routine.calendar.emptyNote")}</span>
        </p>
        <Show when={props.onCreateRoutine}>
          {(create) => (
            <Switch>
              <Match when={props.agents.length === 1 ? props.agents[0] : undefined}>
                {(agent) => (
                  <Button class="routine-planner-empty-action" onClick={() => create()(agent().id)}>
                    {t("routine.settings.create")}
                  </Button>
                )}
              </Match>
              <Match when={props.agents.length > 1}>
                <DropdownMenu.Root placement="bottom" gutter={4}>
                  <DropdownMenu.Trigger class={`${buttonVariants()} routine-planner-empty-action`}>
                    {t("routine.settings.create")}
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content class="routine-planner-empty-menu">
                      <For each={props.agents} keyed={(agent) => agent.id}>
                        {(agent) => (
                          <DropdownMenu.Item
                            class="routine-planner-empty-agent"
                            onSelectAfterClose={() => create()(agent().id)}
                          >
                            <AgentAvatar agent={agent()} class="routine-planner-avatar" />
                            <span>{agent().name}</span>
                          </DropdownMenu.Item>
                        )}
                      </For>
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
              </Match>
            </Switch>
          )}
        </Show>
      </div>
    </div>
  );
}

/** The runs on screen at `step`: the newest one and the ones that still fade. */
function shownRuns(step: number): { key: number; run: SampleRun; slot: number }[] {
  const shown = [];
  for (let index = Math.max(0, step - LIFE + 1); index <= step; index += 1) {
    const run = SAMPLE_RUNS[index % SAMPLE_RUNS.length];
    if (run) shown.push({ key: index, run, slot: index % LIFE });
  }
  return shown;
}

/** The faint month and the runs that land on it. It is decoration: no focus, and hidden from a reader. */
function RoutineCalendarEmptyBoard(props: {
  days: CalendarDay[];
  today: CalendarDay;
  agents: RoutineCalendarAgent[];
  step: number;
}) {
  const { format } = useText();
  const month = () => calendarMonthStart(props.today);
  const rows = () => Math.max(1, Math.ceil(props.days.length / 7));
  // A short month wraps a low run to the top row, which no run near it in time uses.
  const row = (run: SampleRun) => run.row % rows();
  const shown = createMemo(() => shownRuns(props.step));
  return (
    <div class="routine-planner-empty-board" aria-hidden="true">
      <ol class="routine-planner-empty-cells">
        <For each={props.days}>
          {(day) => (
            <li
              class="routine-planner-empty-cell"
              data-today={day === props.today ? "" : undefined}
              data-outside={calendarMonthStart(day) === month() ? undefined : ""}
            >
              {format.date(calendarDayDate(day), { day: "numeric", timeZone: "UTC" })}
            </li>
          )}
        </For>
      </ol>
      <div class="routine-planner-empty-runs">
        <For each={shown()} keyed={(item) => item.key}>
          {(item) => (
            <RoutineCalendarEmptyRun
              run={item().run}
              slot={item().slot}
              row={row(item().run)}
              day={props.days[row(item().run) * 7 + item().run.column]}
              agent={props.agents.length > 0 ? props.agents[item().run.agent % props.agents.length] : undefined}
            />
          )}
        </For>
      </div>
    </div>
  );
}

/** One run card, with the real run styles, and the note it writes below itself. */
function RoutineCalendarEmptyRun(props: {
  run: SampleRun;
  /** A narrow pane has one row for each run on screen. A new run takes the row of the run that just left. */
  slot: number;
  row: number;
  day: CalendarDay | undefined;
  agent: RoutineCalendarAgent | undefined;
}) {
  const { t, format } = useText();
  const lines = () => t(props.run.note).split("\n");
  const time = () => {
    const [hour = 0, minute = 0] = props.run.time.split(":").map(Number);
    return format.date(new Date(Date.UTC(2000, 0, 3, hour, minute)), {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "UTC",
    });
  };
  const lineDelays = createMemo(() => {
    let written = 0;
    return lines().map((line, index) => {
      const delay = WRITE_START_MS + written * MS_PER_CHAR + index * LINE_GAP_MS;
      written += line.length;
      return delay;
    });
  });
  const underlineDelay = () => {
    const chars = lines().reduce((sum, line) => sum + line.length, 0);
    return WRITE_START_MS + chars * MS_PER_CHAR + lines().length * LINE_GAP_MS;
  };
  return (
    <div
      class="routine-planner-empty-run"
      style={{
        "--routine-planner-empty-life": `${STEP_MS * LIFE}ms`,
        "--routine-planner-empty-row": String(props.row + 1),
        "--routine-planner-empty-column": String(props.run.column + 1),
        "--routine-planner-empty-slot": String(props.slot + 1),
      }}
    >
      <Show when={props.day}>
        {(day) => (
          <span class="routine-planner-empty-day">
            {format.date(calendarDayDate(day()), { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })}
          </span>
        )}
      </Show>
      <span class="ui-button routine-planner-run" data-status="completed">
        <span class="routine-planner-status" data-status="completed">
          <Check class="routine-planner-empty-check" />
        </span>
        <span class="routine-planner-run-time">{time()}</span>
        <span class="routine-planner-run-name">{t(props.run.name)}</span>
        <span class="routine-planner-avatars">
          <Show when={props.agent}>{(agent) => <AgentAvatar agent={agent()} class="routine-planner-avatar" />}</Show>
        </span>
      </span>
      <p class="routine-planner-hand routine-planner-empty-note">
        <For each={lines()}>
          {(line, index) => (
            <span
              class="routine-planner-empty-line"
              style={{
                "--routine-planner-empty-delay": `${lineDelays()[index()] ?? 0}ms`,
                "--routine-planner-empty-length": `${line.length * MS_PER_CHAR}ms`,
              }}
            >
              {line}
            </span>
          )}
        </For>
        <svg
          class="routine-planner-empty-underline"
          aria-hidden="true"
          viewBox="0 0 100 8"
          preserveAspectRatio="none"
          style={{ "--routine-planner-empty-delay": `${underlineDelay()}ms` }}
        >
          <path d="M2 5 C 22 2, 42 7, 62 4 S 90 3, 98 5" pathLength="1" />
        </svg>
      </p>
    </div>
  );
}
