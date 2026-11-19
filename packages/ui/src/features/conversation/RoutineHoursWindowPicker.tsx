import { Check, Popover, RadioGroup } from "@openbot/ui";
import { createSignal, Show } from "solid-js";
import { useText } from "../../text";
import { RoutineChipSelect } from "./RoutineChipSelect";
import { RoutineTimeField } from "./RoutineTimeField";
import { createStableChipAnchor } from "./routine-popover-anchor";
import {
  type RoutineHoursWindow,
  routineEveryHoursOptions,
  routineHoursLabel,
  routineRunsPerDayLabel,
} from "./routine-schedule-draft";

interface RoutineHoursWindowPickerProps {
  window: RoutineHoursWindow;
  everyHours: number;
  minute?: number | undefined;
  onChange: (window: RoutineHoursWindow) => void;
  onEveryHoursChange: (everyHours: number) => void;
  disabled?: boolean | undefined;
  onClose?: () => void;
}

const LAST_WINDOW = { start: "09:00", end: "18:00" };

export function RoutineHoursWindowPicker(props: RoutineHoursWindowPickerProps) {
  const text = useText();
  const { t } = text;
  let lastWindow = LAST_WINDOW;
  const [surface, setSurface] = createSignal<HTMLElement>();
  const anchor = createStableChipAnchor(() => props.onClose?.());
  const label = () => routineHoursLabel(props.window, props.minute, text);
  const choose = (value: string) => {
    if (value === "all-day") {
      if (props.window) lastWindow = props.window;
      props.onChange(null);
      return;
    }
    props.onChange(props.window ?? lastWindow);
  };
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
        aria-label={t("routine.hours.chipLabel", { hours: label() })}
        title={label()}
        disabled={props.disabled}
      >
        <span class="routine-chip-text">{label()}</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          ref={(element) => {
            setSurface(element);
            anchor.setContent(element);
          }}
          class="ui-popover-menu-surface routine-popover routine-window-menu"
        >
          <Popover.Title class="sr-only">{t("routine.hours.choose")}</Popover.Title>
          <RadioGroup.Root
            class="routine-window-options"
            aria-label={t("routine.hours.label")}
            value={props.window ? "between" : "all-day"}
            onChange={choose}
          >
            <RadioGroup.Item class="routine-window-option" value="all-day">
              <RadioGroup.ItemInput />
              <RadioGroup.ItemControl class="routine-window-option-control">
                <RadioGroup.ItemLabel class="routine-window-option-label">
                  {t("routine.hours.allDay")}
                </RadioGroup.ItemLabel>
                <RadioGroup.ItemIndicator class="routine-window-option-check">
                  <Check aria-hidden="true" />
                </RadioGroup.ItemIndicator>
              </RadioGroup.ItemControl>
            </RadioGroup.Item>
            <RadioGroup.Item class="routine-window-option" value="between">
              <RadioGroup.ItemInput />
              <RadioGroup.ItemControl class="routine-window-option-control">
                <RadioGroup.ItemLabel class="routine-window-option-label">
                  {t("routine.hours.between")}
                </RadioGroup.ItemLabel>
                <RadioGroup.ItemIndicator class="routine-window-option-check">
                  <Check aria-hidden="true" />
                </RadioGroup.ItemIndicator>
              </RadioGroup.ItemControl>
            </RadioGroup.Item>
          </RadioGroup.Root>
          <Show when={props.window}>
            {(window) => (
              <div class="routine-window-range">
                <div class="routine-window-range-times">
                  <RoutineTimeField
                    label={t("routine.hours.startTime")}
                    value={window().start}
                    onChange={(start) => props.onChange({ ...window(), start })}
                  />
                  <span class="routine-connector" aria-hidden="true">
                    –
                  </span>
                  <RoutineTimeField
                    label={t("routine.hours.endTime")}
                    value={window().end}
                    onChange={(end) => props.onChange({ ...window(), end })}
                  />
                </div>
                <p class="routine-window-range-count" aria-live="polite">
                  {routineRunsPerDayLabel(window(), props.everyHours, text)}
                </p>
              </div>
            )}
          </Show>
          <div class="routine-window-repeat">
            <span class="routine-window-repeat-label" aria-hidden="true">
              {t("routine.hours.repeat")}
            </span>
            <RoutineChipSelect
              ariaLabel={t("routine.hours.repeat")}
              mount={surface()}
              options={routineEveryHoursOptions(text)}
              value={String(props.everyHours)}
              onChange={(value) => props.onEveryHoursChange(Number(value))}
            />
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
