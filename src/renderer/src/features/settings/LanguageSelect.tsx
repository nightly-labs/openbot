import type { JSX } from "@solidjs/web";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui";
import { useI18n } from "../../i18n-context";
import { APP_LANGUAGE_OPTIONS, type AppLanguage, type AppLanguageOption, appLanguageOption } from "./app-languages";

/** Kobalte takes a mutable array. The exported catalog stays read-only, so copy it once here. */
const options: AppLanguageOption[] = [...APP_LANGUAGE_OPTIONS];

export interface LanguageSelectProps {
  value: AppLanguage;
  onChange: (value: AppLanguage) => void;
  disabled?: boolean;
  /** The dialog element the popover portals into, as the other Settings selects receive it. */
  mount?: HTMLElement;
}

/**
 * The language row control. It is a plain `Select`, the same shape as the external-link row beside
 * it, because a settings list that mixes control styles reads as two different screens.
 */
export function LanguageSelect(props: LanguageSelectProps): JSX.Element {
  const i18n = useI18n();
  /**
   * Every row but the first is a language's own name for itself, which is the same word in any
   * interface language. The system row names a setting rather than a language, so it is the one
   * that follows the interface.
   */
  const label = (option: AppLanguageOption) =>
    option.id === "system" ? i18n.t("settings.language.system") : option.label;

  return (
    <Select<AppLanguageOption>
      class="settings-modal-select"
      options={options}
      optionValue="id"
      optionTextValue={label}
      value={appLanguageOption(props.value)}
      disabled={props.disabled}
      onChange={(option) => option && props.onChange(option.id)}
      placement="bottom-end"
      itemComponent={(itemProps) => (
        <SelectItem item={itemProps.item} lang={itemProps.item.rawValue.lang}>
          {label(itemProps.item.rawValue)}
        </SelectItem>
      )}
    >
      <SelectTrigger size="sm" aria-label={i18n.t("settings.language.title")}>
        <SelectValue<AppLanguageOption>>{(state) => label(state.selectedOption())}</SelectValue>
      </SelectTrigger>
      <SelectContent mount={props.mount} />
    </Select>
  );
}
