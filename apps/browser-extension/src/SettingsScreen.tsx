import { ArrowLeft, ChevronDown, Globe2, SwitchField, Trash2 } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createSignal, createUniqueId, For, onSettled, Show } from "solid-js";
import { analyticsLinked, setAnalyticsLinked } from "./analytics";
import { removeAllowedSite, siteName, useAllowedSites } from "./BrowserSharing";
import { readSession } from "./extension-storage";

interface SettingsScreenProps {
  sharing: boolean;
  onBack: () => void;
  onAnalyticsChanged: (enabled: boolean) => void;
}

export function SettingsScreen(props: SettingsScreenProps) {
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
        <div class="ext-settings-rows">
          <Show when={linked() !== null}>
            <div class="ext-settings-row">
              <SwitchField
                checked={linked() === true}
                onChange={(enabled) => void changeAnalytics(enabled).catch(() => undefined)}
                label={t("settings.analytics.title")}
              />
            </div>
          </Show>
          <Show when={props.sharing}>
            <SharedTabsRow />
          </Show>
        </div>
      </div>
    </div>
  );
}

function SharedTabsRow() {
  const { t } = useText();
  const sites = useAllowedSites();
  const [open, setOpen] = createSignal(false);
  const panelId = `ext-settings-shared-${createUniqueId()}`;
  return (
    <div class="ext-settings-disclosure" data-open={open() ? "" : undefined}>
      <button
        type="button"
        class="ext-settings-row ext-settings-toggle"
        aria-expanded={open() ? "true" : "false"}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <span class="ext-settings-label">{t("extension.browser.title")}</span>
        <span class="ext-settings-value">{t("extension.browser.sitesAllowed", { count: sites().length })}</span>
        <ChevronDown size={16} aria-hidden="true" class="ext-settings-chevron" />
      </button>
      <div id={panelId} class="ext-settings-panel" inert={!open()}>
        <div class="ext-settings-panel-inner">
          <p class="ext-settings-note">{t("extension.browser.alwaysAsk")}</p>
          <For each={sites()} fallback={<p class="ext-settings-note">{t("extension.browser.noSites")}</p>}>
            {(site) => (
              <div class="ext-settings-site">
                <Globe2 size={16} aria-hidden="true" />
                <span class="ext-settings-site-name" dir="ltr">
                  {siteName(site)}
                </span>
                <button
                  type="button"
                  class="ext-settings-remove"
                  aria-label={t("extension.browser.revokeSite", { site: siteName(site) })}
                  onClick={() => void removeAllowedSite(site)}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}
