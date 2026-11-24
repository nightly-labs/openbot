import { ArrowLeft, SwitchField } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createSignal, onSettled, Show } from "solid-js";
import { analyticsLinked, setAnalyticsLinked } from "./analytics";
import { readSession } from "./extension-storage";

export function SettingsScreen(props: { onBack: () => void; onAnalyticsChanged: (enabled: boolean) => void }) {
  const { t } = useText();
  const [linked, setLinked] = createSignal<boolean | null>(null);
  onSettled(() => {
    void readSession()
      .then(analyticsLinked)
      .then(setLinked, () => setLinked(null));
  });
  async function changeAnalytics(enabled: boolean) {
    setLinked(enabled);
    await setAnalyticsLinked(enabled);
    props.onAnalyticsChanged(enabled);
  }
  return (
    <div class="ext-form-screen">
      <header class="ch-topbar">
        <button type="button" class="ch-back" aria-label={t("common.back")} onClick={() => props.onBack()}>
          <ArrowLeft size={16} aria-hidden="true" />
        </button>
        <h1 class="ext-form-title">{t("extension.home.settings")}</h1>
      </header>
      <div class="ext-form-body">
        <Show when={linked() !== null}>
          <SwitchField
            checked={linked() === true}
            onChange={(enabled) => void changeAnalytics(enabled).catch(() => undefined)}
            label={t("settings.analytics.title")}
          />
        </Show>
      </div>
    </div>
  );
}
