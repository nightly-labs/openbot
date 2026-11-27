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
  onEditEnd?: () => void;
  disabled?: boolean;
  density?: "panel" | "card";
  today?: Date | undefined;
  kinds?: RoutineDraftKindOption[] | undefined;
  action?: JSX.Element;
}

const CRON_PLACEHOLDER = "0 9 * * 1-5";

type DraftOf<K extends RoutineDraftKind> = Extract<RoutineScheduleDraft, { kind: K }>;

function isDraftOf<K extends RoutineDraftKind>(draft: RoutineScheduleDraft, kind: K): draft is DraftOf<K> {
  return draft.kind === kind;
}

function draftOf<K extends RoutineDraftKind>(draft: RoutineScheduleDraft, kind: K): DraftOf<K> | false {
  return isDraftOf(draft, kind) && draft;
}

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

const fitWidths = new WeakMap<HTMLElement, number>();

function fitRows(pickers: Iterable<HTMLElement>) {
  const connected = [...pickers].filter((picker) => picker.isConnected);
  let pending = connected;
  for (const fit of ROW_FITS) {
    for (const picker of pending) {
      if (picker.dataset.fit !== fit) picker.dataset.fit = fit;
    }
    pending = pending.filter((picker) => !rowFits(picker));
    if (pending.length === 0) break;
  }
  for (const picker of connected) fitWidths.set(picker, picker.clientWidth);
}

const queuedFits = new Set<HTMLElement>();

function queueFit(picker: HTMLElement) {
  if (queuedFits.size === 0) {
    queueMicrotask(() => {
      const pickers = [...queuedFits];
      queuedFits.clear();
      fitRows(pickers);
      if (document.fonts?.status === "loading") {
        void document.fonts.ready.then(() => {
          for (const picker of pickers) queueFit(picker);
        });
      }
    });
  }
  queuedFits.add(picker);
}

let fitObserver: ResizeObserver | undefined;

function observeFit(picker: HTMLElement) {
  fitObserver ??= new ResizeObserver((entries) => {
    for (const { target } of entries) {
      if (target instanceof HTMLElement && target.clientWidth !== fitWidths.get(target)) queueFit(target);
    }
  });
  fitObserver.observe(picker);
  return () => fitObserver?.unobserve(picker);
}

export function RoutineSchedulePicker(props: RoutineSchedulePickerProps) {
  const text = useText();
  const { t } = text;
  const today = () => props.today ?? new Date();
  const kindOptions = () =>
    (props.kinds ?? ROUTINE_DRAFT_KINDS).map((option) => ({ value: option.value, label: t(option.label) }));
  const editEnd = () => props.onEditEnd?.();
  const lateMonthDay = () => {
    const draft = draftOf(props.schedule, "monthly");
    return draft && draft.day > 28 ? draft.day : null;
  };

  const hourlyLabel = () => {
    const draft = draftOf(props.schedule, "hourly");
    return draft && draft.everyHours > 1 ? routineHourlyLabel(draft.everyHours, text) : undefined;
  };

  let picker: HTMLDivElement | undefined;
  createEffect(
    () => [props.schedule, props.density],
    () => {
      if (picker) queueFit(picker);
    },
  );
  onSettled(() => {
    const element = picker;
    if (!element) return;
    return observeFit(element);
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
                  onChange={(event) => {
                    props.onChange({ ...draft(), expression: event.currentTarget.value });
                    editEnd();
                  }}
                />
              )}
            </Match>
          </Switch>
        </span>
        <span class="routine-trigger-action">{props.action}</span>
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

function Phrase(props: { word: string; flexible?: boolean; optional?: boolean; children: JSX.Element }) {
  return (
    <span class={["routine-trigger-phrase", { "routine-trigger-phrase-flexible": props.flexible === true }]}>
      <span class={["routine-connector", { "routine-connector-optional": props.optional === true }]}>{props.word}</span>
      {props.children}
    </span>
  );
}
