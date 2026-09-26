import {
  Badge,
  Button,
  ConfirmDialog,
  ExternalLink,
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemTitle,
  SettingsSection,
  Text,
  Trash2,
} from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { For, Show } from "solid-js";
import { appPort } from "../../app-port";
import type { SettingsHostedSitesStore } from "./stores/hosted-sites-store";

interface SettingsHostedSitesTabProps {
  store: SettingsHostedSitesStore;
  available: boolean;
}

export function SettingsHostedSitesTab(props: SettingsHostedSitesTabProps) {
  const { t, format } = useText();
  const formatDate = (value: string) => format.date(new Date(value), { dateStyle: "medium" });
  return (
    <SettingsSection title={t("settings.hostedSites.title")}>
      <Show when={props.available} fallback={<Text tone="muted">{t("settings.hostedSites.unavailable")}</Text>}>
        <div class="hosted-sites-overview">
          <span class="settings-modal-row-title">
            {t("settings.hostedSites.usage", { used: props.store.state.sites.length })}
          </span>
          <Text tone="muted" variant="caption">
            {t("settings.hostedSites.expiryNote")}
          </Text>
        </div>
        <Show when={props.store.state.error}>{(message) => <p class="settings-modal-error">{message()}</p>}</Show>
        <Show
          when={props.store.state.sites.length > 0}
          fallback={<Text tone="muted">{t("settings.hostedSites.empty")}</Text>}
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
                      onClick={() => void appPort().openUrl(site.url)}
                    >
                      <span class="hosted-sites-link-label">{site.hostname}</span>
                    </Button>
                    <Show
                      when={site.status === "blocked"}
                      fallback={
                        <Text tone="muted" variant="caption">
                          {site.expiresAt
                            ? t("settings.hostedSites.expires", { date: formatDate(site.expiresAt) })
                            : t("settings.hostedSites.expiryUnavailable")}
                        </Text>
                      }
                    >
                      <Badge tone="neutral">{t("settings.hostedSites.blocked")}</Badge>
                    </Show>
                  </ItemContent>
                  <ItemActions class="hosted-sites-actions">
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={t("settings.hostedSites.openLabel", { hostname: site.hostname })}
                      disabled={site.status !== "active"}
                      onClick={() => void appPort().openUrl(site.url)}
                    >
                      <ExternalLink size={14} aria-hidden="true" />
                      {t("common.open")}
                    </Button>
                    <Button
                      variant="destructive-ghost"
                      size="sm"
                      aria-label={t("settings.hostedSites.deleteLabel", { hostname: site.hostname })}
                      disabled={props.store.state.busy}
                      onClick={() => props.store.requestDelete(site)}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                      {t("common.delete")}
                    </Button>
                  </ItemActions>
                </Item>
              )}
            </For>
          </ItemGroup>
        </Show>
        <ConfirmDialog
          open={props.store.state.pendingDelete !== null}
          title={t("settings.hostedSites.deleteTitle", { hostname: props.store.state.pendingDelete?.hostname ?? "" })}
          description={t("settings.hostedSites.deleteDescription")}
          confirmLabel={t("common.delete")}
          pendingLabel={t("settings.hostedSites.deleting")}
          pending={props.store.state.busy}
          error={props.store.state.deleteError ?? undefined}
          onCancel={props.store.cancelDelete}
          onConfirm={props.store.confirmDelete}
        />
      </Show>
    </SettingsSection>
  );
}
