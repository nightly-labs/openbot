import { Select, SelectContent, SelectItem, SelectPrimitive } from "@openbot/ui";
import { useText } from "../../text";
import type { RoutineSelectOption } from "./routine-schedule-ui";

interface RoutineChipSelectProps {
  ariaLabel: string;
  value: string;
  options: RoutineSelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean | undefined;
  valueLabel?: string | undefined;
  flexible?: boolean;
  mount?: HTMLElement | undefined;
  onClose?: () => void;
}

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
      disabled={props.disabled ?? false}
      sameWidth={false}
      placement="bottom-start"
      gutter={6}
      onOpenChange={(next) => {
        open = next;
        if (!next) {
          props.onClose?.();
          return;
        }
        window.requestAnimationFrame(() =>
          document.querySelector(".routine-chip-select-content [data-selected]")?.scrollIntoView({ block: "center" }),
        );
      }}
      onChange={(option) => {
        if (!option || option.value === props.value) return;
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
