import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@openbot/ui";
import { createMemo } from "solid-js";
import { useText } from "../../text";

const PRESETS: readonly number[] = [30, 60, 120, 300, 1_000];

/** The menu items. A saved limit that is not a preset (from the preference file) is an item of its own. */
function choices(value: number): number[] {
  return PRESETS.includes(value) ? [...PRESETS] : [...PRESETS, value].sort((a, b) => a - b);
}

export interface AutomationLimitRowProps {
  /** Messages and routine runs that local scripts can send each agent in one hour. */
  value: number;
  /** The dialog element that the menus portal into. */
  menuMount: HTMLElement | undefined;
  onChange: (value: number) => void;
}

/**
 * "Requests an hour", under the default of "Local scripts": how many messages and routine runs
 * local scripts can send each agent in one hour.
 */
export function AutomationLimitRow(props: AutomationLimitRowProps) {
  const { t, format } = useText();
  // A new options array makes the Select report its value again, so the array changes only with the limit.
  const value = createMemo(() => props.value);
  const options = createMemo(() => choices(value()));
  const choiceText = (limit: number) => t("settings.automationLimit.option", { limit: format.number(limit) });

  return (
    <Item class="settings-modal-row">
      <ItemContent>
        <ItemTitle>{t("settings.automationLimit.title")}</ItemTitle>
        <ItemDescription>{t("settings.automationLimit.note")}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <Select<number>
          options={options()}
          value={props.value}
          placement="bottom-end"
          onChange={(next) => {
            // The Select also reports the current value. Saving it again would start a loop (#5614).
            if (next !== null && next !== props.value) props.onChange(next);
          }}
          itemComponent={(item) => <SelectItem item={item.item}>{choiceText(item.item.rawValue)}</SelectItem>}
        >
          <SelectTrigger size="sm" class="server-roles-level" aria-label={t("settings.automationLimit.title")}>
            <SelectValue<number>>{() => choiceText(props.value)}</SelectValue>
          </SelectTrigger>
          <SelectContent mount={props.menuMount} />
        </Select>
      </ItemActions>
    </Item>
  );
}
