import type { AppVariant } from "@openbot/contracts/ipc";
import { type AppLanguage, formatLocale, type TranslatedLocale } from "@openbot/i18n";
import { LanguageWheel } from "@openbot/ui/features/account/LanguageWheel";
import { TextProvider } from "@openbot/ui/text";
import { createSignal, onSettled } from "solid-js";
import { desktopAnalytics } from "../../analytics";
import { useI18n } from "../../i18n-context";

export function LanguageStep(props: { variant: AppVariant; reopened: boolean; onDone: () => void }) {
  const i18n = useI18n();
  const [chosen, setChosen] = createSignal<TranslatedLocale | null>(null);
  const language = () => chosen() ?? i18n.locale();
  const formatLanguage = (): AppLanguage => (language() === i18n.locale() ? i18n.language() : language());

  onSettled(() => {
    if (!props.reopened) desktopAnalytics.track("onboarding_step", { step: "language", action: "viewed" });
  });

  function finish(): void {
    if (!props.reopened) desktopAnalytics.track("onboarding_step", { step: "language", action: "next" });
    if (language() !== i18n.locale()) i18n.changeLanguage(language());
    props.onDone();
  }

  return (
    <TextProvider
      locale={language()}
      formatLocale={formatLocale(formatLanguage(), navigator.language, i18n.hourCycle())}
    >
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
