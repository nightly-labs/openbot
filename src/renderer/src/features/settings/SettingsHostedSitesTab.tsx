import { For, Show } from "solid-js";
import {
  Badge,
  Button,
  ExternalLink,
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemTitle,
  SettingsSection,
  Text,
  Trash2,
} from "../../components/ui";
import { useI18n } from "../i18n/i18n-context";
import type { SettingsHostedSitesStore } from "./stores/hosted-sites-store";

interface SettingsHostedSitesTabProps {
  store: SettingsHostedSitesStore;
  available: boolean;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
}

export function SettingsHostedSitesTab(props: SettingsHostedSitesTabProps) {
  const i18n = useI18n();
  return (
    <SettingsSection title={i18n.t("settings.hostedSites.title")}>
      <Show when={props.available} fallback={<Text tone="muted">{i18n.t("settings.hostedSites.unavailable")}</Text>}>
        <div class="hosted-sites-overview">
          <span class="settings-modal-row-title">
            {props.store.state.sites.length} {i18n.t("settings.hostedSites.of")} 10{" "}
            {i18n.t("settings.hostedSites.site")}
          </span>
          <Text tone="muted" variant="caption">
            {i18n.t("settings.hostedSites.expiryDescription")}
          </Text>
        </div>
        <Show when={props.store.state.error}>{(message) => <p class="settings-modal-error">{message()}</p>}</Show>
        <Show
          when={props.store.state.sites.length > 0}
          fallback={<Text tone="muted">{i18n.t("settings.hostedSites.empty")}</Text>}
        >
          <ItemGroup class="settings-modal-card hosted-sites-list" surface="subtle">
            <For each={props.store.state.sites}>
              {(site) => (
                <Item class="hosted-sites-row">
                  <ItemContent>
                    <ItemTitle>{site.title}</ItemTitle>
                    <Button
                      type="button"
                      variant="link"
                      class="hosted-sites-link"
                      title={site.hostname}
                      disabled={site.status !== "active"}
                      onClick={() => void window.openbot.openUrl(site.url)}
                    >
                      <span class="hosted-sites-link-label">{site.hostname}</span>
                    </Button>
                    <Show
                      when={site.status === "blocked"}
                      fallback={
                        <Text tone="muted" variant="caption">
                          {site.expiresAt
                            ? `${i18n.t("settings.hostedSites.expires")} ${formatDate(site.expiresAt)}`
                            : i18n.t("settings.hostedSites.expiryUnavailable")}
                        </Text>
                      }
                    >
                      <Badge tone="neutral">{i18n.t("settings.hostedSites.blocked")}</Badge>
                    </Show>
                  </ItemContent>
                  <ItemActions class="hosted-sites-actions">
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={`${i18n.t("settings.hostedSites.open")} ${site.hostname}`}
                      disabled={site.status !== "active"}
                      onClick={() => void window.openbot.openUrl(site.url)}
                    >
                      <ExternalLink size={14} aria-hidden="true" />
                      {i18n.t("settings.hostedSites.openAction")}
                    </Button>
                    <Button
                      variant="destructive-ghost"
                      size="sm"
                      aria-label={`${i18n.t("settings.hostedSites.delete")} ${site.hostname}`}
                      disabled={props.store.state.busy}
                      onClick={() => void props.store.deleteSite(site)}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                      {i18n.t("settings.hostedSites.deleteAction")}
                    </Button>
                  </ItemActions>
                </Item>
              )}
            </For>
          </ItemGroup>
        </Show>
      </Show>
    </SettingsSection>
  );
}
