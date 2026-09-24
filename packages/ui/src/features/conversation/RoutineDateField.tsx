import { Button, ChevronLeft, ChevronRight, IconButton, Popover } from "@openbot/ui";
import { createMemo, createSignal, For, flush, Show } from "solid-js";
import { createStableChipAnchor } from "./routine-popover-anchor";
import {
  formatRoutineDate,
  isRoutineYearlyCalendarYear,
  parseRoutineDateKey,
  ROUTINE_EVERY_DAY,
  routineDateChipLabel,
  routineDateKey,
  routineMonthName,
  routineMonthShort,
  routineWeekdayInitial,
  routineWeekdayName,
  routineYearlyCalendarDate,
} from "./routine-schedule-draft";

interface RoutineDateFieldProps {
  value: string;
  /** The first date that can be picked. Earlier days are disabled. */
  today: Date;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** A month and a day that repeat each year: no year, no weekdays, and no past dates. */
  yearly?: boolean;
  /** The popover closed, so the edit is complete. */
  onClose?: () => void;
}

/** A chip that opens a one-month calendar, for a routine that runs once or each year. */
export function RoutineDateField(props: RoutineDateFieldProps) {
  const [open, setOpen] = createSignal(false);
  const anchor = createStableChipAnchor(() => props.onClose?.());
  const date = () => parseRoutineDateKey(props.value);
  const label = () =>
    props.yearly
      ? `${routineMonthShort(date().getMonth() + 1)} ${date().getDate()}`
      : routineDateChipLabel(props.value, props.today);
  return (
    <Popover.Root
      modal
      open={open()}
      onOpenChange={(next) => {
        anchor.onOpenChange(next);
        setOpen(next);
      }}
      placement="bottom-start"
      gutter={6}
      getAnchorRect={anchor.getAnchorRect}
    >
      <Popover.Trigger
        class="routine-chip routine-chip-flexible"
        aria-label={`Date: ${props.yearly ? label() : formatRoutineDate(props.value)}`}
        title={label()}
        disabled={props.disabled}
      >
        <span class="routine-chip-text">{label()}</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          ref={anchor.setContent}
          class="ui-popover-menu-surface routine-popover routine-calendar-popover"
        >
          <Popover.Title class="sr-only">Choose date</Popover.Title>
          <RoutineCalendar
            value={props.value}
            today={props.today}
            yearly={props.yearly}
            onSelect={(value) => {
              props.onChange(value);
              anchor.onOpenChange(false);
              setOpen(false);
            }}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

const NAVIGATION_STEPS: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };

function RoutineCalendar(props: { value: string; today: Date; yearly?: boolean; onSelect: (value: string) => void }) {
  const todayKey = () => routineDateKey(props.today);
  const [month, setMonth] = createSignal(() => monthStart(parseRoutineDateKey(props.value)));
  const [focusKey, setFocusKey] = createSignal(() => props.value);
  let grid: HTMLFieldSetElement | undefined;

  const days = createMemo(() => {
    const first = month();
    const count = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    return Array.from({ length: count }, (_, index) =>
      routineDateKey(new Date(first.getFullYear(), first.getMonth(), index + 1)),
    );
  });
  // A yearly day has no weekday, so its grid starts at the first cell.
  const leadingBlanks = () => Array.from({ length: props.yearly ? 0 : month().getDay() });
  const isPast = (key: string) => !props.yearly && key < todayKey();
  // One day in the month takes Tab; the arrow keys move it. A month paged away from the
  // focused day hands the stop to its first day that can be picked.
  const tabStop = () => (days().includes(focusKey()) ? focusKey() : (days().find((key) => !isPast(key)) ?? ""));
  const canGoBack = () => props.yearly || month() > monthStart(props.today);
  const title = () =>
    props.yearly
      ? routineMonthName(month().getMonth() + 1)
      : `${routineMonthName(month().getMonth() + 1)} ${month().getFullYear()}`;

  // A yearly calendar pages from December back to January.
  const inCalendar = (date: Date) =>
    props.yearly && !isRoutineYearlyCalendarYear(date)
      ? routineYearlyCalendarDate(date.getMonth(), date.getDate())
      : date;

  const showMonth = (offset: number) => {
    const current = month();
    setMonth(inCalendar(new Date(current.getFullYear(), current.getMonth() + offset, 1)));
  };

  const moveFocus = (event: KeyboardEvent, key: string) => {
    const step = NAVIGATION_STEPS[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const date = parseRoutineDateKey(key);
    const next = inCalendar(new Date(date.getFullYear(), date.getMonth(), date.getDate() + step));
    const nextKey = routineDateKey(next);
    if (isPast(nextKey)) return;
    setFocusKey(nextKey);
    setMonth(monthStart(next));
    flush();
    grid?.querySelector<HTMLElement>(`[data-date="${nextKey}"]`)?.focus();
  };

  return (
    <div class="routine-calendar">
      <div class="routine-calendar-header">
        <IconButton
          label="Previous month"
          variant="ghost"
          size="icon-xs"
          disabled={!canGoBack()}
          onClick={() => showMonth(-1)}
        >
          <ChevronLeft aria-hidden="true" />
        </IconButton>
        <span class="routine-calendar-title" aria-live="polite">
          {title()}
        </span>
        <IconButton label="Next month" variant="ghost" size="icon-xs" onClick={() => showMonth(1)}>
          <ChevronRight aria-hidden="true" />
        </IconButton>
      </div>
      <Show when={!props.yearly}>
        <div class="routine-calendar-weekdays" aria-hidden="true">
          <For each={ROUTINE_EVERY_DAY}>{(day) => <span>{routineWeekdayInitial(day)}</span>}</For>
        </div>
      </Show>
      <fieldset ref={(element) => (grid = element)} class="routine-calendar-days" aria-label={title()}>
        <For each={leadingBlanks()}>{() => <span />}</For>
        <For each={days()}>
          {(key) => {
            const date = parseRoutineDateKey(key);
            return (
              <Button
                type="button"
                variant="ghost"
                class={["routine-day", "routine-calendar-day", { "routine-day-selected": key === props.value }]}
                data-date={key}
                tabindex={key === tabStop() ? 0 : -1}
                disabled={isPast(key)}
                aria-label={
                  props.yearly
                    ? `${routineMonthName(date.getMonth() + 1)} ${date.getDate()}`
                    : `${routineWeekdayName(date.getDay())}, ${routineMonthName(date.getMonth() + 1)} ${date.getDate()}, ${date.getFullYear()}`
                }
                aria-pressed={key === props.value ? "true" : "false"}
                aria-current={!props.yearly && key === todayKey() ? "date" : undefined}
                onFocus={() => setFocusKey(key)}
                onKeyDown={(event: KeyboardEvent) => moveFocus(event, key)}
                onClick={() => props.onSelect(key)}
              >
                {date.getDate()}
              </Button>
            );
          }}
        </For>
      </fieldset>
    </div>
  );
}

function monthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}
