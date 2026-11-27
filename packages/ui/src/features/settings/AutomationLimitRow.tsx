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

function choices(value: number): number[] {
  return PRESETS.includes(value) ? [...PRESETS] : [...PRESETS, value].sort((a, b) => a - b);
}

export interface AutomationLimitRowProps {
  value: number;
  menuMount: HTMLElement | undefined;
  onChange: (value: number) => void;
}

export function AutomationLimitRow(props: AutomationLimitRowProps) {
  const { t, format } = useText();
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
