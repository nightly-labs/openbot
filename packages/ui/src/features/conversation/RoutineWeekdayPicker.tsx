import { Button, Popover, RadioGroup } from "@openbot/ui";
import { For, Show } from "solid-js";
import { createStableChipAnchor } from "./routine-popover-anchor";
import {
  ROUTINE_EVERY_DAY,
  routineDayChipLabel,
  routineDaySetLabel,
  routineWeekdayInitial,
  routineWeekdayName,
  routineWeekdayShort,
  toggleRoutineDay,
} from "./routine-schedule-draft";

type RoutineWeekdayPickerProps = (
  | { mode: "many"; days: number[]; onChange: (days: number[]) => void }
  | { mode: "one"; day: number; onChange: (day: number) => void }
) & {
  disabled?: boolean;
  /** The popover closed, so the edit is complete. */
  onClose?: () => void;
};

/**
 * A chip that opens the S M T W T F S strip. Daily and hourly runs toggle any set of days;
 * a weekly run picks exactly one, so it is a radio group and the arrow keys move the choice.
 */
export function RoutineWeekdayPicker(props: RoutineWeekdayPickerProps) {
  const anchor = createStableChipAnchor(() => props.onClose?.());
  const label = () => (props.mode === "many" ? routineDaySetLabel(props.days) : routineWeekdayShort(props.day));
  const chipLabel = () => (props.mode === "many" ? routineDayChipLabel(props.days) : label());
  return (
    <Popover.Root
      modal
      placement="bottom-start"
      gutter={6}
      getAnchorRect={anchor.getAnchorRect}
      onOpenChange={anchor.onOpenChange}
    >
      <Popover.Trigger
        class="routine-chip routine-chip-flexible"
        aria-label={`Days: ${label()}`}
        title={chipLabel() === label() ? undefined : label()}
        disabled={props.disabled}
      >
        <span class="routine-chip-text">{chipLabel()}</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          ref={anchor.setContent}
          class="ui-popover-menu-surface routine-popover routine-weekday-popover"
        >
          <Popover.Title class="sr-only">Choose days</Popover.Title>
          <Show
            when={props.mode === "many" && props}
            fallback={
              <Show when={props.mode === "one" && props}>
                {(single) => <SingleWeekday day={single().day} onChange={single().onChange} />}
              </Show>
            }
          >
            {(many) => <ManyWeekdays days={many().days} onChange={many().onChange} />}
          </Show>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function ManyWeekdays(props: { days: number[]; onChange: (days: number[]) => void }) {
  return (
    <fieldset class="routine-weekday-strip" aria-label="Days">
      <For each={ROUTINE_EVERY_DAY}>
        {(day) => {
          const selected = () => props.days.includes(day);
          return (
            <Button
              type="button"
              variant="ghost"
              class={["routine-day", { "routine-day-selected": selected() }]}
              aria-label={routineWeekdayName(day)}
              aria-pressed={selected() ? "true" : "false"}
              // The last day stays on, and saying so beats a click that does nothing.
              title={selected() && props.days.length === 1 ? "At least one day is required" : undefined}
              onClick={() => props.onChange(toggleRoutineDay(props.days, day))}
            >
              {routineWeekdayInitial(day)}
            </Button>
          );
        }}
      </For>
    </fieldset>
  );
}

function SingleWeekday(props: { day: number; onChange: (day: number) => void }) {
  return (
    <RadioGroup.Root
      class="routine-weekday-strip"
      aria-label="Day"
      orientation="horizontal"
      value={String(props.day)}
      onChange={(value) => props.onChange(Number(value))}
    >
      <For each={ROUTINE_EVERY_DAY}>
        {(day) => (
          <RadioGroup.Item class="routine-day-item" value={String(day)}>
            <RadioGroup.ItemInput aria-label={routineWeekdayName(day)} />
            <RadioGroup.ItemControl class={["routine-day", { "routine-day-selected": props.day === day }]}>
              <span aria-hidden="true">{routineWeekdayInitial(day)}</span>
            </RadioGroup.ItemControl>
          </RadioGroup.Item>
        )}
      </For>
    </RadioGroup.Root>
  );
}
