import type { AppLanguage } from "@openbot/contracts/app-language";
import type { AppVariant } from "@openbot/contracts/ipc";
import { formatLocale, resolveLocale, type TranslatedLocale } from "@openbot/i18n";
import { LanguageWheel } from "@openbot/ui/features/account/LanguageWheel";
import { createSignal } from "solid-js";
import { StaticI18nProvider } from "../../i18n-context";

/**
 * The language wheel that the language button of the web sign-in opens. Turning
 * the wheel redraws only this screen; Continue saves the choice once. The language that shows
 * already stays as it is saved, so "system" keeps following the browser.
 */
export function WebLanguageStep(props: {
  variant: AppVariant;
  language: AppLanguage;
  onChangeLanguage: (language: AppLanguage) => void;
  onDone: () => void;
}) {
  const saved = () => resolveLocale(props.language, navigator.language);
  const [chosen, setChosen] = createSignal<TranslatedLocale | null>(null);
  const shown = () => chosen() ?? saved();
  function finish(): void {
    if (shown() !== saved()) props.onChangeLanguage(shown());
    props.onDone();
  }
  return (
    <StaticI18nProvider
      locale={shown()}
      formatLocale={formatLocale(shown() === saved() ? props.language : shown(), navigator.language)}
    >
      <LanguageWheel
        variant={props.variant}
        systemLocale={navigator.language}
        language={shown()}
        onChange={setChosen}
        onContinue={finish}
      />
    </StaticI18nProvider>
  );
}
