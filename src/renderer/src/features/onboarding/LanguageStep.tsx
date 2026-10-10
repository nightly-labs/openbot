import type { AppVariant } from "@openbot/contracts/ipc";
import { type AppLanguage, formatLocale, type TranslatedLocale } from "@openbot/i18n";
import { LanguageWheel } from "@openbot/ui/features/account/LanguageWheel";
import { TextProvider } from "@openbot/ui/text";
import { createSignal } from "solid-js";
import { useI18n } from "../../i18n-context";

/**
 * The language wheel before sign-in. Turning the wheel redraws only this screen; Continue saves the
 * choice once, so the native menu and the saved setting do not change on each row.
 */
export function LanguageStep(props: { variant: AppVariant; onDone: () => void }) {
  const i18n = useI18n();
  // Null until the wheel turns, so the saved language that arrives after the first frame still opens it.
  const [chosen, setChosen] = createSignal<TranslatedLocale | null>(null);
  const language = () => chosen() ?? i18n.locale();
  // The preview sets the app-wide number and date locale too. While the language shown is the saved one,
  // it keeps the main provider's value, which Continue then does not change.
  const formatLanguage = (): AppLanguage => (language() === i18n.locale() ? i18n.language() : language());

  function finish(): void {
    // The language already shown stays as it is saved, so "system" keeps following the computer.
    if (language() !== i18n.locale()) i18n.changeLanguage(language());
    props.onDone();
  }

  return (
    <TextProvider locale={language()} formatLocale={formatLocale(formatLanguage(), navigator.language)}>
      <LanguageWheel
        variant={props.variant}
        systemLocale={navigator.language}
        language={language()}
        onChange={setChosen}
        onContinue={finish}
      />
    </TextProvider>
  );
}
