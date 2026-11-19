import {
  APP_LANGUAGE_OPTIONS,
  type AppLanguage,
  type AppLanguageOption,
  appLanguageOption,
} from "@openbot/i18n/languages";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { useText } from "../../text";

const options: AppLanguageOption[] = [...APP_LANGUAGE_OPTIONS];

export interface LanguageSelectProps {
  value: AppLanguage;
  onChange: (value: AppLanguage) => void;
  disabled?: boolean | undefined;
  mount?: HTMLElement | undefined;
}

export function LanguageSelect(props: LanguageSelectProps): JSX.Element {
  const { t } = useText();
  const label = (option: AppLanguageOption) => (option.id === "system" ? t("settings.language.system") : option.label);

  return (
    <Select<AppLanguageOption>
      class="settings-modal-select"
      options={options}
      optionValue="id"
      optionTextValue={label}
      value={appLanguageOption(props.value)}
      disabled={props.disabled ?? false}
      onChange={(option) => option && props.onChange(option.id)}
      placement="bottom-end"
      itemComponent={(itemProps) => (
        <SelectItem item={itemProps.item} lang={itemProps.item.rawValue.lang}>
          {label(itemProps.item.rawValue)}
        </SelectItem>
      )}
    >
      <SelectTrigger size="sm" aria-label={t("settings.language.title")}>
        <SelectValue<AppLanguageOption>>{(state) => label(state.selectedOption())}</SelectValue>
      </SelectTrigger>
      <SelectContent mount={props.mount} />
    </Select>
  );
}
