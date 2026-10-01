import { APP_LOGO_COLOR_HEX, APP_LOGO_COLORS, type AppLogoColor } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { Button } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { For } from "solid-js";
import { useText } from "../../text";

const COLOR_LABEL_KEYS = {
  lavender: "settings.logoColor.lavender",
  green: "settings.logoColor.green",
  gold: "settings.logoColor.gold",
  terracotta: "settings.logoColor.terracotta",
  blue: "settings.logoColor.blue",
  rose: "settings.logoColor.rose",
  pink: "settings.logoColor.pink",
  beige: "settings.logoColor.beige",
  gray: "settings.logoColor.gray",
  white: "settings.logoColor.white",
} as const satisfies Record<AppLogoColor, AppTextKey>;

export interface LogoColorPickerProps {
  value: AppLogoColor;
  onChange: (value: AppLogoColor) => void;
}

/** One swatch for each logo color, in the same shape as the agent avatar color grid. */
export function LogoColorPicker(props: LogoColorPickerProps): JSX.Element {
  const { t } = useText();
  return (
    <fieldset class="logo-color-grid" aria-label={t("settings.logoColor.title")}>
      <For each={APP_LOGO_COLORS}>
        {(color) => (
          <Button
            variant="ghost"
            type="button"
            class={["logo-color-choice", { "logo-color-choice-selected": props.value === color }]}
            aria-label={t(COLOR_LABEL_KEYS[color])}
            aria-pressed={props.value === color ? "true" : "false"}
            onClick={() => props.onChange(color)}
          >
            <span class="logo-color-swatch" style={{ background: APP_LOGO_COLOR_HEX[color] }} />
          </Button>
        )}
      </For>
    </fieldset>
  );
}
