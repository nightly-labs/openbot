import { APP_APPEARANCES, type AppAppearance, isAppAppearance } from "@openbot/contracts/app-appearance";
import type { AppTextKey } from "@openbot/i18n";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createMemo } from "solid-js";
import { useText } from "../../text";

/** A light, dark or system choice, or `palette:<id>` for a theme palette file. */
export type AppearanceSelectValue = AppAppearance | `palette:${string}`;

const PALETTE_PREFIX = "palette:";

/** The select value of a saved preference: the palette while one is selected, else the appearance. */
export function appearanceSelectValue(preference: {
  appearance: AppAppearance;
  palette: string | null;
}): AppearanceSelectValue {
  return preference.palette === null ? preference.appearance : `${PALETTE_PREFIX}${preference.palette}`;
}

/** The palette id of a select value, or null for a light, dark or system choice. */
function paletteOfSelectValue(value: AppearanceSelectValue): string | null {
  return isAppAppearance(value) ? null : value.slice(PALETTE_PREFIX.length);
}

/**
 * The preference change that a select value makes. A palette choice changes only the palette, so
 * the light, dark or system choice comes back when the palette is cleared; the others clear it.
 */
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
  /** The name that the palette file gives. It is data, so it shows as written. */
  name: string;
}

export interface AppearanceSelectProps {
  value: AppearanceSelectValue;
  onChange: (value: AppearanceSelectValue) => void;
  /** Theme palette files, listed after the light, dark and system choices. */
  palettes?: readonly AppearanceSelectPalette[] | undefined;
  /** The dialog element the popover portals into, as the other Settings selects receive it. */
  mount?: HTMLElement | undefined;
}

/** The theme row control: follow the system, always light or dark, or a theme palette file. */
export function AppearanceSelect(props: AppearanceSelectProps): JSX.Element {
  const { t } = useText();
  // Kobalte takes a mutable array, and a new array makes it choose again, so the list changes only
  // when its values change.
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
      // Kobalte reports the selected value again when the options change. Only a new choice is sent.
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
