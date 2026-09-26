import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { AlarmClock, Input } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createEffect, Match, onSettled, Show, Switch } from "solid-js";
import { useText } from "../../text";
import { RoutineChipSelect } from "./RoutineChipSelect";
import { RoutineDateField } from "./RoutineDateField";
import { RoutineHoursWindowPicker } from "./RoutineHoursWindowPicker";
import { RoutineTimeField } from "./RoutineTimeField";
import { RoutineWeekdayPicker } from "./RoutineWeekdayPicker";
import {
  isRoutineDraftKind,
  parseRoutineDateKey,
  ROUTINE_DRAFT_KINDS,
  type RoutineDraftKind,
  type RoutineDraftKindOption,
  type RoutineScheduleDraft,
  routineHourlyLabel,
  routineMonthDayOptions,
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
  kinds?: RoutineDraftKindOption[];
}

/** A cron example. It is the same in each language. */
const CRON_PLACEHOLDER = "0 9 * * 1-5";

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
  const text = useText();
  const { t } = text;
  const today = () => props.today ?? new Date();
  const kindOptions = () =>
    (props.kinds ?? ROUTINE_DRAFT_KINDS).map((option) => ({ value: option.value, label: t(option.label) }));
  const editEnd = () => props.onEditEnd?.();
  // Days 29 to 31 do not exist in every month, and the run skips those months.
  const lateMonthDay = () => {
    const draft = draftOf(props.schedule, "monthly");
    return draft && draft.day > 28 ? draft.day : null;
  };

  // An hourly run with a longer step names it on the frequency chip: "Every 2h".
  const hourlyLabel = () => {
    const draft = draftOf(props.schedule, "hourly");
    return draft && draft.everyHours > 1 ? routineHourlyLabel(draft.everyHours, text) : undefined;
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
      <fieldset class="routine-trigger-row" aria-label={t("routine.picker.schedule")}>
        <span class="routine-trigger-icon" aria-hidden="true">
          <AlarmClock />
        </span>
        <span class="routine-trigger-chips">
          <RoutineChipSelect
            ariaLabel={t("routine.picker.frequency")}
            options={kindOptions()}
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
                  <Phrase word={t("routine.picker.on")} flexible>
                    <RoutineDateField
                      value={draft().date}
                      today={today()}
                      disabled={props.disabled}
                      onClose={editEnd}
                      onChange={(date) => props.onChange({ ...draft(), date })}
                    />
                  </Phrase>
                  <Phrase word={t("routine.picker.at")}>
                    <RoutineTimeField
                      label={t("routine.picker.time")}
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
                  <Phrase word={t("routine.picker.on")} flexible optional>
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
                  <Phrase word={t("routine.picker.on")} flexible>
                    <RoutineWeekdayPicker
                      mode="many"
                      days={draft().days}
                      disabled={props.disabled}
                      onClose={editEnd}
                      onChange={(days) => props.onChange({ ...draft(), days })}
                    />
                  </Phrase>
                  <Phrase word={t("routine.picker.at")}>
                    <RoutineTimeField
                      label={t("routine.picker.time")}
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
                  <Phrase word={t("routine.picker.on")} flexible>
                    <RoutineWeekdayPicker
                      mode="one"
                      day={draft().weekday}
                      disabled={props.disabled}
                      onClose={editEnd}
                      onChange={(weekday) => props.onChange({ ...draft(), weekday })}
                    />
                  </Phrase>
                  <Phrase word={t("routine.picker.at")}>
                    <RoutineTimeField
                      label={t("routine.picker.time")}
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
                  <Phrase word={t("routine.picker.on")} flexible>
                    <RoutineChipSelect
                      ariaLabel={t("routine.picker.dayOfMonth")}
                      flexible
                      options={routineMonthDayOptions(text)}
                      value={String(draft().day)}
                      disabled={props.disabled}
                      onClose={editEnd}
                      onChange={(day) => props.onChange({ ...draft(), day: Number(day) })}
                    />
                  </Phrase>
                  <Phrase word={t("routine.picker.at")}>
                    <RoutineTimeField
                      label={t("routine.picker.time")}
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
                  <Phrase word={t("routine.picker.on")} flexible>
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
                  <Phrase word={t("routine.picker.at")}>
                    <RoutineTimeField
                      label={t("routine.picker.time")}
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
                  aria-label={t("routine.picker.cronExpression")}
                  spellcheck={false}
                  placeholder={CRON_PLACEHOLDER}
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
        {(day) => <p class="routine-schedule-hint">{t("routine.picker.lateMonthDay", { day: day() })}</p>}
      </Show>
      <Show when={props.schedule.kind === "custom"}>
        <p class="routine-schedule-hint">{t("routine.picker.cronHint")}</p>
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
