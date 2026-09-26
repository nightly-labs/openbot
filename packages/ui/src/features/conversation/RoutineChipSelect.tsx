import { Select, SelectContent, SelectItem, SelectPrimitive } from "@openbot/ui";
import { useText } from "../../text";
import type { RoutineSelectOption } from "./routine-schedule-ui";

interface RoutineChipSelectProps {
  ariaLabel: string;
  value: string;
  options: RoutineSelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Shown in place of the selected option's label, when the chip says more than the menu. */
  valueLabel?: string;
  /** A value chip that can cut its label short when the row is too narrow. */
  flexible?: boolean;
  /** The element that holds the list. A select inside a modal popover opens in it, or the popover hides the list. */
  mount?: HTMLElement;
  /** A pick is complete: the menu closed, or a key chose a value while the menu was closed. */
  onClose?: () => void;
}

/** A `Select` dressed as a chip. The chip has no icon: its fill shows that it opens a menu. */
export function RoutineChipSelect(props: RoutineChipSelectProps) {
  const { t } = useText();
  const selected = () => props.options.find((option) => option.value === props.value) ?? null;
  let open = false;
  return (
    <Select<RoutineSelectOption>
      class={["routine-chip-select", { "routine-chip-select-flexible": props.flexible === true }]}
      options={props.options}
      value={selected()}
      optionValue="value"
      optionTextValue="label"
      disabled={props.disabled}
      sameWidth={false}
      placement="bottom-start"
      gutter={6}
      onOpenChange={(next) => {
        open = next;
        if (!next) {
          props.onClose?.();
          return;
        }
        // A long list, like the 31 days of a month, opens on the day already chosen.
        window.requestAnimationFrame(() =>
          document.querySelector(".routine-chip-select-content [data-selected]")?.scrollIntoView({ block: "center" }),
        );
      }}
      onChange={(option) => {
        if (!option) return;
        props.onChange(option.value);
        if (!open) props.onClose?.();
      }}
      itemComponent={(item) => <SelectItem item={item.item}>{item.item.rawValue.label}</SelectItem>}
    >
      <SelectPrimitive.Trigger
        class={["routine-chip", { "routine-chip-flexible": props.flexible === true }]}
        aria-label={props.ariaLabel}
      >
        <SelectPrimitive.Value<RoutineSelectOption> class="routine-chip-text">
          {(state) => props.valueLabel ?? state.selectedOption()?.label ?? t("routine.chip.select")}
        </SelectPrimitive.Value>
      </SelectPrimitive.Trigger>
      <SelectContent class="routine-chip-select-content" mount={props.mount} />
    </Select>
  );
}
