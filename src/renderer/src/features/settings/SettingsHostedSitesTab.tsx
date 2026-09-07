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
import type { SettingsHostedSitesStore } from "./stores/hosted-sites-store";

interface SettingsHostedSitesTabProps {
  store: SettingsHostedSitesStore;
  available: boolean;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
}

export function SettingsHostedSitesTab(props: SettingsHostedSitesTabProps) {
  return (
    <SettingsSection title="Your sites">
      <Show when={props.available} fallback={<Text tone="muted">Site hosting is unavailable.</Text>}>
        <div class="hosted-sites-overview">
          <span class="settings-modal-row-title">{props.store.state.sites.length} of 10 sites</span>
          <Text tone="muted" variant="caption">
            Sites expire 30 days after publication. Ask an agent to publish or update a site.
          </Text>
        </div>
        <Show when={props.store.state.error}>{(message) => <p class="settings-modal-error">{message()}</p>}</Show>
        <Show
          when={props.store.state.sites.length > 0}
          fallback={<Text tone="muted">You do not have a hosted site yet. Ask an agent to publish one.</Text>}
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
                          {site.expiresAt ? `Expires ${formatDate(site.expiresAt)}` : "Expiry unavailable"}
                        </Text>
                      }
                    >
                      <Badge tone="neutral">Blocked</Badge>
                    </Show>
                  </ItemContent>
                  <ItemActions class="hosted-sites-actions">
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={`Open ${site.hostname}`}
                      disabled={site.status !== "active"}
                      onClick={() => void window.openbot.openUrl(site.url)}
                    >
                      <ExternalLink size={14} aria-hidden="true" />
                      Open
                    </Button>
                    <Button
                      variant="destructive-ghost"
                      size="sm"
                      aria-label={`Delete ${site.hostname}`}
                      disabled={props.store.state.busy}
                      onClick={() => void props.store.deleteSite(site)}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                      Delete
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
