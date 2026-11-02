import { APP_APPEARANCES, type AppAppearance } from "@openbot/contracts/app-appearance";
import type { AppTextKey } from "@openbot/i18n";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { useText } from "../../text";

/** Kobalte takes a mutable array. The contract list stays read-only, so copy it once here. */
const options: AppAppearance[] = [...APP_APPEARANCES];

const APPEARANCE_KEYS = {
  system: "settings.appearance.theme.system",
  light: "settings.appearance.theme.light",
  dark: "settings.appearance.theme.dark",
} as const satisfies Record<AppAppearance, AppTextKey>;

export interface AppearanceSelectProps {
  value: AppAppearance;
  onChange: (value: AppAppearance) => void;
  /** The dialog element the popover portals into, as the other Settings selects receive it. */
  mount?: HTMLElement | undefined;
}

/** The theme row control: follow the system, or always light or dark. */
export function AppearanceSelect(props: AppearanceSelectProps): JSX.Element {
  const { t } = useText();
  const label = (value: AppAppearance | undefined) => (value === undefined ? "" : t(APPEARANCE_KEYS[value]));

  return (
    <Select<AppAppearance>
      class="settings-modal-select"
      options={options}
      value={props.value}
      onChange={(value) => value && props.onChange(value)}
      placement="bottom-end"
      itemComponent={(itemProps) => <SelectItem item={itemProps.item}>{label(itemProps.item.rawValue)}</SelectItem>}
    >
      <SelectTrigger size="sm" aria-label={t("settings.appearance.theme.title")}>
        <SelectValue<AppAppearance>>{(state) => label(state.selectedOption())}</SelectValue>
      </SelectTrigger>
      <SelectContent mount={props.mount} />
    </Select>
  );
}
