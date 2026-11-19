import { APP_APPEARANCES, type AppAppearance, isAppAppearance } from "@openbot/contracts/app-appearance";
import type { AppTextKey } from "@openbot/i18n";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createMemo } from "solid-js";
import { useText } from "../../text";

export type AppearanceSelectValue = AppAppearance | `palette:${string}`;

const PALETTE_PREFIX = "palette:";

export function appearanceSelectValue(preference: {
  appearance: AppAppearance;
  palette: string | null;
}): AppearanceSelectValue {
  return preference.palette === null ? preference.appearance : `${PALETTE_PREFIX}${preference.palette}`;
}

function paletteOfSelectValue(value: AppearanceSelectValue): string | null {
  return isAppAppearance(value) ? null : value.slice(PALETTE_PREFIX.length);
}

export function appearanceChangeOfSelectValue(
  value: AppearanceSelectValue,
): { appearance: AppAppearance; palette: null } | { palette: string } {
  return isAppAppearance(value)
    ? { appearance: value, palette: null }
    : { palette: value.slice(PALETTE_PREFIX.length) };
}

const APPEARANCE_KEYS = {
  system: "settings.appearance.theme.system",
  light: "settings.appearance.theme.light",
  dark: "settings.appearance.theme.dark",
} as const satisfies Record<AppAppearance, AppTextKey>;

function sameValues(before: readonly AppearanceSelectValue[], after: readonly AppearanceSelectValue[]): boolean {
  return before.length === after.length && before.every((value, index) => value === after[index]);
}

export interface AppearanceSelectPalette {
  id: string;
  name: string;
}

export interface AppearanceSelectProps {
  value: AppearanceSelectValue;
  onChange: (value: AppearanceSelectValue) => void;
  palettes?: readonly AppearanceSelectPalette[] | undefined;
  mount?: HTMLElement | undefined;
}

export function AppearanceSelect(props: AppearanceSelectProps): JSX.Element {
  const { t } = useText();
  const options = createMemo(
    (): AppearanceSelectValue[] => [
      ...APP_APPEARANCES,
      ...(props.palettes ?? []).map((palette): AppearanceSelectValue => `${PALETTE_PREFIX}${palette.id}`),
    ],
    { equals: sameValues },
  );
  const label = (value: AppearanceSelectValue | undefined) => {
    if (value === undefined) return "";
    if (isAppAppearance(value)) return t(APPEARANCE_KEYS[value]);
    const id = paletteOfSelectValue(value);
    return props.palettes?.find((palette) => palette.id === id)?.name ?? "";
  };

  return (
    <Select<AppearanceSelectValue>
      class="settings-modal-select"
      options={options()}
      value={props.value}
      onChange={(value) => value && value !== props.value && props.onChange(value)}
      placement="bottom-end"
      itemComponent={(itemProps) => <SelectItem item={itemProps.item}>{label(itemProps.item.rawValue)}</SelectItem>}
    >
      <SelectTrigger size="sm" aria-label={t("settings.appearance.theme.title")}>
        <SelectValue<AppearanceSelectValue>>{(state) => label(state.selectedOption())}</SelectValue>
      </SelectTrigger>
      <SelectContent mount={props.mount} />
    </Select>
  );
}
