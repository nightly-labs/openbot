import type { AppTextKey } from "@openbot/i18n";
import { Input, Popover, RadioGroup } from "@openbot/ui";
import { createSignal, For } from "solid-js";
import { useText } from "../../text";
import { createStableChipAnchor } from "./routine-popover-anchor";
import {
  formatRoutineClockShort,
  joinClock,
  type RoutineClock,
  type RoutineClockParts,
  type RoutineMeridiem,
  splitClock,
  typedClockHour,
  wrapClockValue,
} from "./routine-schedule-draft";

interface RoutineTimeFieldProps {
  label: string;
  value: RoutineClock;
  onChange: (value: RoutineClock) => void;
  disabled?: boolean;
  /** The popover closed, so the edit is complete. */
  onClose?: () => void;
}

/** A chip that shows the time and opens an hour, minute and AM/PM editor. */
export function RoutineTimeField(props: RoutineTimeFieldProps) {
  const text = useText();
  const anchor = createStableChipAnchor(() => props.onClose?.());
  return (
    <Popover.Root
      modal
      placement="bottom-start"
      gutter={6}
      getAnchorRect={anchor.getAnchorRect}
      onOpenChange={anchor.onOpenChange}
    >
      <Popover.Trigger
        class="routine-chip"
        aria-label={text.t("routine.time.chipLabel", {
          label: props.label,
          time: formatRoutineClockShort(props.value, text),
        })}
        disabled={props.disabled}
      >
        <span class="routine-chip-text">{formatRoutineClockShort(props.value, text)}</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content ref={anchor.setContent} class="ui-popover-menu-surface routine-popover routine-time-popover">
          <Popover.Title class="sr-only">{props.label}</Popover.Title>
          <RoutineClockInput label={props.label} value={props.value} onChange={props.onChange} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

const MERIDIEMS: RoutineMeridiem[] = ["AM", "PM"];

const MERIDIEM_LABEL = {
  AM: "routine.clock.am",
  PM: "routine.clock.pm",
} as const satisfies Record<RoutineMeridiem, AppTextKey>;

/**
 * Hour and minute boxes take any typed value and commit it on Enter or blur. The arrow keys
 * step and commit at once, so holding one scrolls the time the way a native picker does.
 */
function RoutineClockInput(props: { label: string; value: RoutineClock; onChange: (value: RoutineClock) => void }) {
  const { t } = useText();
  const parts = () => splitClock(props.value);
  const [hourText, setHourText] = createSignal(() => String(parts().hour));
  const [minuteText, setMinuteText] = createSignal(() => String(parts().minute).padStart(2, "0"));

  const commit = (next: Partial<RoutineClockParts>) => {
    const value = joinClock({ ...parts(), ...next });
    if (value !== props.value) props.onChange(value);
    // A typed value that does not change the clock ("9" to "09") still has to be redrawn.
    setHourText(String(splitClock(value).hour));
    setMinuteText(String(splitClock(value).minute).padStart(2, "0"));
  };

  const typed = (text: string, fallback: number) => {
    const value = Number.parseInt(text, 10);
    return Number.isFinite(value) ? value : fallback;
  };

  const commitHour = () => commit(typedClockHour(typed(hourText(), parts().hour), parts().meridiem));
  const commitMinute = () => commit({ minute: typed(minuteText(), parts().minute) });

  const stepKey = (event: KeyboardEvent, field: "hour" | "minute") => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (field === "hour") commitHour();
      else commitMinute();
      return;
    }
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const step = event.key === "ArrowUp" ? 1 : -1;
    if (field === "hour") commit({ hour: wrapClockValue(parts().hour + step, 1, 12) });
    else commit({ minute: wrapClockValue(parts().minute + step, 0, 59) });
  };

  return (
    <div class="routine-clock-input">
      <Input
        class="routine-clock-segment"
        size="sm"
        inputmode="numeric"
        maxlength={2}
        aria-label={t("routine.time.hour", { label: props.label })}
        value={hourText()}
        onValueChange={setHourText}
        onKeyDown={(event) => stepKey(event, "hour")}
        onBlur={commitHour}
      />
      <span class="routine-clock-separator" aria-hidden="true">
        :
      </span>
      <Input
        class="routine-clock-segment"
        size="sm"
        inputmode="numeric"
        maxlength={2}
        aria-label={t("routine.time.minute", { label: props.label })}
        value={minuteText()}
        onValueChange={setMinuteText}
        onKeyDown={(event) => stepKey(event, "minute")}
        onBlur={commitMinute}
      />
      <RadioGroup.Root
        class="routine-segmented"
        aria-label={t("routine.time.meridiem", { label: props.label })}
        orientation="horizontal"
        value={parts().meridiem}
        onChange={(value) => commit({ meridiem: value === "PM" ? "PM" : "AM" })}
      >
        <For each={MERIDIEMS}>
          {(meridiem) => (
            <RadioGroup.Item class="routine-segmented-item" value={meridiem}>
              <RadioGroup.ItemInput />
              <RadioGroup.ItemControl class="routine-segmented-control">
                <RadioGroup.ItemLabel>{t(MERIDIEM_LABEL[meridiem])}</RadioGroup.ItemLabel>
              </RadioGroup.ItemControl>
            </RadioGroup.Item>
          )}
        </For>
      </RadioGroup.Root>
    </div>
  );
}
