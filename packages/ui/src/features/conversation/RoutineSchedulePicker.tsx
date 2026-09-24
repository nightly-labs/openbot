import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { AlarmClock, Input } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createEffect, Match, onSettled, Show, Switch } from "solid-js";
import { RoutineChipSelect } from "./RoutineChipSelect";
import { RoutineDateField } from "./RoutineDateField";
import { RoutineHoursWindowPicker } from "./RoutineHoursWindowPicker";
import { RoutineTimeField } from "./RoutineTimeField";
import { RoutineWeekdayPicker } from "./RoutineWeekdayPicker";
import {
  isRoutineDraftKind,
  parseRoutineDateKey,
  ROUTINE_DRAFT_KINDS,
  ROUTINE_MONTH_DAY_OPTIONS,
  type RoutineDraftKind,
  type RoutineScheduleDraft,
  routineHourlyLabel,
  routineYearlyDateKey,
  switchDraftKind,
} from "./routine-schedule-draft";

export interface RoutineSchedulePickerProps {
  schedule: RoutineScheduleDraft;
  onChange: (schedule: RoutineScheduleDraft) => void;
  /**
   * One edit is complete: a chip menu or popover closed, or the cron field committed. A consumer
   * that saves each edit saves here, because `onChange` also runs for each step inside a popover.
   */
  onEditEnd?: () => void;
  disabled?: boolean;
  /** `card` is the tighter row used inside a chat message. */
  density?: "panel" | "card";
  /** The first day a one-time run can use, and the source of new dates. Defaults to now. */
  today?: Date;
  /** The frequencies the menu offers. Defaults to all of them. */
  kinds?: { value: RoutineDraftKind; label: string }[];
}

type DraftOf<K extends RoutineDraftKind> = Extract<RoutineScheduleDraft, { kind: K }>;

function isDraftOf<K extends RoutineDraftKind>(draft: RoutineScheduleDraft, kind: K): draft is DraftOf<K> {
  return draft.kind === kind;
}

function draftOf<K extends RoutineDraftKind>(draft: RoutineScheduleDraft, kind: K): DraftOf<K> | false {
  return isDraftOf(draft, kind) && draft;
}

/** From the most space to the least. The last step hides the icon and the connector words. */
const ROW_FITS = ["roomy", "snug", "tight", "minimal"] as const;

function rowFits(picker: HTMLElement): boolean {
  const chips = picker.querySelector(".routine-trigger-chips");
  const last = chips?.lastElementChild;
  if (chips && last && last.getBoundingClientRect().right > chips.getBoundingClientRect().right + 0.5) return false;
  return Array.from(
    picker.querySelectorAll(".routine-chip-text"),
    (text) => text.scrollWidth <= text.clientWidth,
  ).every(Boolean);
}

/**
 * Gives the row the most space that still shows every label whole. The step depends on the
 * labels, not only on the width: "Daily on Weekdays at 7 AM" needs less room than an hourly row.
 */
function fitRow(picker: HTMLElement) {
  for (const fit of ROW_FITS) {
    picker.dataset.fit = fit;
    if (rowFits(picker)) return;
  }
}

/**
 * The schedule as one sentence of chips: "[Daily] on [Every day] at [7:30 AM]". Each chip opens
 * the smallest control that edits it, and a change of frequency keeps the time already set.
 */
export function RoutineSchedulePicker(props: RoutineSchedulePickerProps) {
  const today = () => props.today ?? new Date();
  const editEnd = () => props.onEditEnd?.();
  // Days 29 to 31 do not exist in every month, and the run skips those months.
  const lateMonthDay = () => {
    const draft = draftOf(props.schedule, "monthly");
    return draft && draft.day > 28 ? draft.day : null;
  };

  // An hourly run with a longer step names it on the frequency chip: "Every 2h".
  const hourlyLabel = () => {
    const draft = draftOf(props.schedule, "hourly");
    return draft && draft.everyHours > 1 ? routineHourlyLabel(draft.everyHours) : undefined;
  };

  let picker: HTMLDivElement | undefined;
  createEffect(
    () => [props.schedule, props.density],
    () => {
      if (picker) fitRow(picker);
    },
  );
  onSettled(() => {
    const element = picker;
    if (!element) return;
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth === width) return;
      width = element.clientWidth;
      fitRow(element);
    });
    observer.observe(element);
    void document.fonts?.ready.then(() => fitRow(element));
    return () => observer.disconnect();
  });

  return (
    <div
      ref={(element) => {
        picker = element;
      }}
      class="routine-schedule-picker"
      data-density={props.density ?? "panel"}
    >
      <fieldset class="routine-trigger-row" aria-label="Schedule">
        <span class="routine-trigger-icon" aria-hidden="true">
          <AlarmClock />
        </span>
        <span class="routine-trigger-chips">
          <RoutineChipSelect
            ariaLabel="Frequency"
            options={props.kinds ?? ROUTINE_DRAFT_KINDS}
            value={props.schedule.kind}
            valueLabel={hourlyLabel()}
            disabled={props.disabled}
            onClose={editEnd}
            onChange={(kind) => {
              if (isRoutineDraftKind(kind)) props.onChange(switchDraftKind(props.schedule, kind, today()));
            }}
          />
          <Switch>
            <Match when={draftOf(props.schedule, "once")}>
              {(draft) => (
                <>
                  <Phrase word="on" flexible>
                    <RoutineDateField
                      value={draft().date}
                      today={today()}
                      disabled={props.disabled}
                      onClose={editEnd}
                      onChange={(date) => props.onChange({ ...draft(), date })}
                    />
                  </Phrase>
                  <Phrase word="at">
                    <RoutineTimeField
                      label="Time"
                      value={draft().time}
                      disabled={props.disabled}
                      onClose={editEnd}
                      onChange={(time) => props.onChange({ ...draft(), time })}
                    />
                  </Phrase>
                </>
              )}
            </Match>
            <Match when={draftOf(props.schedule, "hourly")}>
              {(draft) => (
                <>
                  <Phrase word="on" flexible optional>
                    <RoutineWeekdayPicker
                      mode="many"
                      days={draft().days}
                      disabled={props.disabled}
                      onClose={editEnd}
                      onChange={(days) => props.onChange({ ...draft(), days })}
                    />
                  </Phrase>
                  <RoutineHoursWindowPicker
                    window={draft().window}
                    everyHours={draft().everyHours}
                    minute={draft().minute}
                    disabled={props.disabled}
                    onClose={editEnd}
                    onChange={(window) => props.onChange({ ...draft(), window })}
                    onEveryHoursChange={(everyHours) => props.onChange({ ...draft(), everyHours })}
                  />
                </>
              )}
            </Match>
            <Match when={draftOf(props.schedule, "daily")}>
              {(draft) => (
                <>
                  <Phrase word="on" flexible>
                    <RoutineWeekdayPicker
                      mode="many"
                      days={draft().days}
                      disabled={props.disabled}
                      onClose={editEnd}
                      onChange={(days) => props.onChange({ ...draft(), days })}
                    />
                  </Phrase>
                  <Phrase word="at">
                    <RoutineTimeField
                      label="Time"
                      value={draft().time}
                      disabled={props.disabled}
                      onClose={editEnd}
                      onChange={(time) => props.onChange({ ...draft(), time })}
                    />
                  </Phrase>
                </>
              )}
            </Match>
            <Match when={draftOf(props.schedule, "weekly")}>
              {(draft) => (
                <>
                  <Phrase word="on" flexible>
                    <RoutineWeekdayPicker
                      mode="one"
                      day={draft().weekday}
                      disabled={props.disabled}
                      onClose={editEnd}
                      onChange={(weekday) => props.onChange({ ...draft(), weekday })}
                    />
                  </Phrase>
                  <Phrase word="at">
                    <RoutineTimeField
                      label="Time"
                      value={draft().time}
                      disabled={props.disabled}
                      onClose={editEnd}
                      onChange={(time) => props.onChange({ ...draft(), time })}
                    />
                  </Phrase>
                </>
              )}
            </Match>
            <Match when={draftOf(props.schedule, "monthly")}>
              {(draft) => (
                <>
                  <Phrase word="on" flexible>
                    <RoutineChipSelect
                      ariaLabel="Day of month"
                      flexible
                      options={ROUTINE_MONTH_DAY_OPTIONS}
                      value={String(draft().day)}
                      disabled={props.disabled}
                      onClose={editEnd}
                      onChange={(day) => props.onChange({ ...draft(), day: Number(day) })}
                    />
                  </Phrase>
                  <Phrase word="at">
                    <RoutineTimeField
                      label="Time"
                      value={draft().time}
                      disabled={props.disabled}
                      onClose={editEnd}
                      onChange={(time) => props.onChange({ ...draft(), time })}
                    />
                  </Phrase>
                </>
              )}
            </Match>
            <Match when={draftOf(props.schedule, "yearly")}>
              {(draft) => (
                <>
                  <Phrase word="on" flexible>
                    <RoutineDateField
                      yearly
                      value={routineYearlyDateKey(draft().month, draft().day)}
                      today={today()}
                      disabled={props.disabled}
                      onClose={editEnd}
                      onChange={(value) => {
                        const date = parseRoutineDateKey(value);
                        props.onChange({ ...draft(), month: date.getMonth() + 1, day: date.getDate() });
                      }}
                    />
                  </Phrase>
                  <Phrase word="at">
                    <RoutineTimeField
                      label="Time"
                      value={draft().time}
                      disabled={props.disabled}
                      onClose={editEnd}
                      onChange={(time) => props.onChange({ ...draft(), time })}
                    />
                  </Phrase>
                </>
              )}
            </Match>
            <Match when={draftOf(props.schedule, "custom")}>
              {(draft) => (
                <Input
                  class="routine-cron-input"
                  size="sm"
                  aria-label="Cron expression"
                  spellcheck={false}
                  placeholder="0 9 * * 1-5"
                  maxlength={INPUT_LIMITS.routineCron}
                  value={draft().expression}
                  disabled={props.disabled}
                  // The expression saves when the field commits it (blur or Enter), not after each key.
                  onChange={(event) => {
                    props.onChange({ ...draft(), expression: event.currentTarget.value });
                    editEnd();
                  }}
                />
              )}
            </Match>
          </Switch>
        </span>
      </fieldset>
      <Show when={lateMonthDay()}>
        {(day) => <p class="routine-schedule-hint">Skipped in months without day {day()}.</p>}
      </Show>
      <Show when={props.schedule.kind === "custom"}>
        <p class="routine-schedule-hint">Five fields: minute, hour, day of month, month, day of week.</p>
      </Show>
    </div>
  );
}

/**
 * A connector word and its chip. The row never wraps; a `flexible` phrase is the one that
 * shrinks, and its chip cuts its label short, when the row is too narrow. An `optional` word is
 * hidden in the narrowest panels, where the row still reads without it.
 */
function Phrase(props: { word: string; flexible?: boolean; optional?: boolean; children: JSX.Element }) {
  return (
    <span class={["routine-trigger-phrase", { "routine-trigger-phrase-flexible": props.flexible === true }]}>
      <span class={["routine-connector", { "routine-connector-optional": props.optional === true }]}>{props.word}</span>
      {props.children}
    </span>
  );
}
