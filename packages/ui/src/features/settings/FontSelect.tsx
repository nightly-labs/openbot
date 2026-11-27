import type { AppFontFamily } from "@openbot/contracts/app-appearance";
import { SearchSelect } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createMemo } from "solid-js";
import { useText } from "../../text";

interface FontOption {
  font: AppFontFamily | null;
}

const DEFAULT_OPTION: FontOption = { font: null };

const DEFAULT_FONTS = {
  interface: "var(--openbot-font-sans-default)",
  code: "var(--openbot-font-mono-default)",
} as const;

export interface FontSelectProps {
  kind: "interface" | "code";
  value: AppFontFamily | null;
  onChange: (value: AppFontFamily | null) => void;
  fonts: readonly AppFontFamily[];
  "aria-labelledby": string;
  mount?: HTMLElement | undefined;
  systemFontDefault?: boolean | undefined;
}

export function FontSelect(props: FontSelectProps): JSX.Element {
  const { t } = useText();
  const missing = createMemo(() => (props.value !== null && !props.fonts.includes(props.value) ? props.value : null));
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
      itemContent={(option) => (
        <span class="settings-font-option" style={{ "font-family": fontFamily(option) }}>
          {label(option)}
        </span>
      )}
      aria-labelledby={props["aria-labelledby"]}
      mount={props.mount}
    />
  );
}
