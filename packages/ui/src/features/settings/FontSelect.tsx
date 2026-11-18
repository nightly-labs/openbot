import type { AppFontFamily } from "@openbot/contracts/app-appearance";
import { SearchSelect } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createMemo } from "solid-js";
import { useText } from "../../text";

/** One row of the list: a font, or null for the default fonts. */
interface FontOption {
  font: AppFontFamily | null;
}

const DEFAULT_OPTION: FontOption = { font: null };

const DEFAULT_FONTS = {
  interface: "var(--openbot-font-sans-default)",
  code: "var(--openbot-font-mono-default)",
} as const;

export interface FontSelectProps {
  /** The interface font or the code font. Each row of the list draws in its font, over these defaults. */
  kind: "interface" | "code";
  /** The chosen font, or null for the default fonts. */
  value: AppFontFamily | null;
  onChange: (value: AppFontFamily | null) => void;
  /** The fonts of this computer. A chosen font that is not in the list stays in it, after the default. */
  fonts: readonly AppFontFamily[];
  /** The id of the row title, which names the control. */
  "aria-labelledby": string;
  /** The dialog element the popover portals into, as the other Settings selects receive it. */
  mount?: HTMLElement | undefined;
  /** macOS: the default interface font is the system font, not Inter. */
  systemFontDefault?: boolean | undefined;
}

/**
 * A searchable list of the fonts that are installed on this computer, with the default first. Each
 * row draws in its own font, so the user sees the font before choosing it.
 */
export function FontSelect(props: FontSelectProps): JSX.Element {
  const { t } = useText();
  // A saved font that this computer does not have, such as one that was removed.
  const missing = createMemo(() => (props.value !== null && !props.fonts.includes(props.value) ? props.value : null));
  // A new array only when the fonts change, not at each choice: a new array makes the list draw again.
  const options = createMemo<FontOption[]>(() => {
    const extra = missing();
    const fonts = extra === null ? props.fonts : [extra, ...props.fonts];
    return [DEFAULT_OPTION, ...fonts.map((font) => ({ font }))];
  });
  const interfaceDefaultLabel = () =>
    props.systemFontDefault ? t("settings.interfaceFont.defaultSystem") : t("settings.interfaceFont.default");
  const selected = () => options().find((option) => option.font === props.value) ?? DEFAULT_OPTION;
  const label = (option: FontOption) =>
    option.font ?? (props.kind === "code" ? t("settings.codeFont.default") : interfaceDefaultLabel());
  const fontFamily = (option: FontOption) =>
    option.font === null ? DEFAULT_FONTS[props.kind] : `"${option.font}", ${DEFAULT_FONTS[props.kind]}`;
  return (
    <SearchSelect<FontOption>
      class="settings-modal-select"
      size="sm"
      placement="bottom-end"
      options={options()}
      value={selected()}
      onChange={(option) => props.onChange(option.font)}
      label={label}
      optionValue={(option) => (option.font === null ? "default" : `font:${option.font}`)}
      itemContent={(option) => <span style={{ "font-family": fontFamily(option) }}>{label(option)}</span>}
      aria-labelledby={props["aria-labelledby"]}
      mount={props.mount}
    />
  );
}
