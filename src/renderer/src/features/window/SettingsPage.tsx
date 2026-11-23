import type { AppTextKey } from "@openbot/i18n";
import { Button, Server, Store } from "@openbot/ui";
import { CONNECTOR_LISTINGS } from "@openbot/ui/features/connectors/connector-catalog";
import type { ConnectorId } from "@openbot/ui/features/connectors/connectors";
import { waitForSettingRow } from "@openbot/ui/features/conversation/agent-setting-links";
import { createEffect, createSignal, For, flush, onCleanup, Show } from "solid-js";
import { useI18n } from "../../i18n-context";
import { usePlatform } from "../../platform";
import { useAuth } from "../account/account-context";
import { useConnectors } from "../connectors/connectors-context";
import { canManageStorage, serverHasBackgroundProcesses } from "../files/storage-usage";
import type { ServerSettingsSection } from "../servers/ServerSettingsModal";
import {
  activeServerHasProviderSettings,
  serverHasAgentDefaults,
  serverSupportsCapability,
} from "../servers/server-capabilities";
import { useServerSettings } from "../servers/server-settings";
import { useServers } from "../servers/servers-context";
import { useSettings } from "../settings/settings-context";
import { navItem, navItems, type SettingsTab, settingsRowShown, settingsTabShown } from "../settings/settings-tabs";
import {
  openFirstSettingsSection,
  PersonalSettingsLink,
  ServerSettingsLink,
  ServerSettingsPageTitle,
  SettingsPageFrame,
  SettingsSearchField,
} from "./SettingsPageFrame";
import { type SettingsKind, useWindowPage } from "./window-page-context";

type PersonalRow = {
  tab: SettingsTab;
  titleKey: AppTextKey;
  descriptionKey?: AppTextKey;
  anchor?: AppTextKey;
  macOS?: boolean;
};

type ServerRow = { section: ServerSettingsSection; titleKey: AppTextKey; descriptionKey?: AppTextKey };

type MarketplaceRow = { app: ConnectorId | null; titleKey: AppTextKey; descriptionKey?: AppTextKey };

type SearchRow = PersonalRow | ServerRow | MarketplaceRow;

const SEARCH_ROWS: ReadonlyArray<PersonalRow> = navItems.flatMap((item) => [
  { tab: item.value, titleKey: item.titleKey, descriptionKey: item.descriptionKey },
  ...item.rows.map((row) => ({ tab: item.value, ...row, anchor: row.titleKey })),
]);

const PROVIDERS_ROW: ServerRow = {
  section: "providers",
  titleKey: "server.settings.providersTitle",
  descriptionKey: "server.settings.providersDescription",
};

const IMPORT_ROW: ServerRow = {
  section: "import",
  titleKey: "server.settings.importTitle",
  descriptionKey: "server.settings.importDescription",
};

const AGENTS_ROWS: ReadonlyArray<ServerRow> = [
  {
    section: "agents",
    titleKey: "server.settings.agentDefaultsTitle",
    descriptionKey: "server.settings.agentsDescription",
  },
  { section: "agents", titleKey: "agentSettings.automation.title" },
  { section: "agents", titleKey: "agentSettings.agentNewChat.title" },
  { section: "agents", titleKey: "agentSettings.quickAcknowledgement.title" },
  { section: "agents", titleKey: "settings.busyMessage.title", descriptionKey: "settings.busyMessage.description" },
];

const BACKGROUND_PROCESSES_ROW: ServerRow = {
  section: "storage",
  titleKey: "settings.backgroundProcesses.title",
  descriptionKey: "settings.backgroundProcesses.description",
};

const MARKETPLACE_APPS_ROW: MarketplaceRow = { app: null, titleKey: "app.settingsPage.marketplaceApps" };

const SEARCH_LIMIT = 12;

function rankRows(query: string, rows: ReadonlyArray<SearchRow>, text: (key: AppTextKey) => string): SearchRow[] {
  const needle = query.toLocaleLowerCase();
  const score = (row: SearchRow) => {
    const title = text(row.titleKey).toLocaleLowerCase();
    if (title.startsWith(needle)) return 0;
    if (title.includes(needle)) return 1;
    return row.descriptionKey && text(row.descriptionKey).toLocaleLowerCase().includes(needle) ? 2 : 3;
  };
  return rows
    .map((row) => ({ row, rank: score(row) }))
    .filter((entry) => entry.rank < 3)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, SEARCH_LIMIT)
    .map((entry) => entry.row);
}

export function SettingsPage(props: { kind: SettingsKind }) {
  const i18n = useI18n();
  const windowPage = useWindowPage();
  const settings = useSettings();
  const serverSettings = useServerSettings();
  const platform = usePlatform();
  const connectors = useConnectors();
  const { activeServer } = useServers();
  const { signedInAccount } = useAuth();
  const [personalQuery, setPersonalQuery] = createSignal("");
  const query = () => (props.kind === "personal" ? personalQuery() : windowPage.serverSettingsQuery());
  const setQuery = (value: string) =>
    props.kind === "personal" ? setPersonalQuery(value) : windowPage.setServerSettingsQuery(value);
  onCleanup(() => windowPage.setServerSettingsQuery(""));
  const tabShown = (tab: SettingsTab) =>
    settingsTabShown(tab, { platform: platform.appInfo()?.platform, chatWindow: platform.chatWindow !== null });
  const searchRows = (): SearchRow[] => {
    const server = activeServer();
    const personal = SEARCH_ROWS.filter(
      (row) => tabShown(row.tab) && settingsRowShown(row, platform.appInfo()?.platform),
    );
    if (!server) return personal;
    return [
      ...personal,
      ...(activeServerHasProviderSettings(server) ? [PROVIDERS_ROW] : []),
      ...(serverSupportsCapability(server, "agent-import-v1") ? [IMPORT_ROW] : []),
      ...(serverHasAgentDefaults(server) ? AGENTS_ROWS : []),
      ...(serverHasBackgroundProcesses(server) &&
      canManageStorage(server) &&
      (server.kind === "local" || server.state === "online")
        ? [BACKGROUND_PROCESSES_ROW]
        : []),
      MARKETPLACE_APPS_ROW,
      ...connectors.active.available().map(
        ({ id }): MarketplaceRow => ({
          app: id,
          titleKey: CONNECTOR_LISTINGS[id].title,
          descriptionKey: CONNECTOR_LISTINGS[id].tagline,
        }),
      ),
    ];
  };
  const results = () =>
    props.kind === "personal" && query().trim() ? rankRows(query().trim(), searchRows(), (key) => i18n.t(key)) : null;
  const resultStatus = () => {
    const rows = results();
    if (!rows) return "";
    return rows.length > 0
      ? i18n.t("app.settingsPage.resultCount", { count: rows.length })
      : i18n.t("app.settingsPage.noResults");
  };
  let content: HTMLElement | undefined;
  const [contentElement, setContentElement] = createSignal<HTMLElement | undefined>();
  let nav: HTMLElement | undefined;

  const openResult = (row: SearchRow) => {
    setQuery("");
    if ("app" in row) {
      settings.setPendingPluginConnect(false);
      settings.setPendingPluginSlug(row.app);
      settings.setSkillsMarketplaceOpen(true);
      return;
    }
    if ("section" in row) {
      const server = activeServer();
      if (server) serverSettings.openServerSettings(server.id, null, row.section);
      return;
    }
    settings.openAppSettings(null, undefined);
    flush();
    settings.openAppSettings(null, row.tab);
    flush();
    if (!content) return;
    for (const marked of content.querySelectorAll("[data-search-match]")) marked.removeAttribute("data-search-match");
    if (row.anchor) markRow(content, row.tab, row.anchor);
  };

  const markRow = (root: HTMLElement, tab: SettingsTab, anchor: AppTextKey): boolean => {
    const selector: string = `.settings-modal-tab-panel[data-tab="${tab}"] [data-settings-row="${anchor}"]`;
    const found = root.querySelector(selector);
    const target = found?.closest(".settings-modal-card > *") ?? found;
    if (!(target instanceof HTMLElement)) return false;
    for (const marked of root.querySelectorAll("[data-search-match]")) marked.removeAttribute("data-search-match");
    target.setAttribute("data-search-match", "");
    target.scrollIntoView({ block: "center" });
    target.querySelector<HTMLElement>("button, input, select, [tabindex]")?.focus({ preventScroll: true });
    return true;
  };

  let handledRowNonce = 0;
  createEffect(
    () => ({ request: settings.appSettingRowRequest(), root: contentElement() }),
    ({ request, root }) => {
      if (props.kind !== "personal" || !request || !root || request.nonce === handledRowNonce) return;
      handledRowNonce = request.nonce;
      if (markRow(root, request.tab, request.anchor)) return;
      return waitForSettingRow(root, () => markRow(root, request.tab, request.anchor));
    },
  );

  return (
    <SettingsPageFrame
      heading={
        <Show
          when={props.kind === "personal"}
          fallback={
            <Show when={serverSettings.serverSettingsTarget()}>
              {(server) => <ServerSettingsPageTitle server={server()} />}
            </Show>
          }
        >
          <h1 class="settings-page-title" tabindex={-1}>
            {i18n.t("app.settingsPage.title")}
          </h1>
        </Show>
      }
      sectionsHidden={results() !== null}
      footer={
        <Show
          when={props.kind === "personal"}
          fallback={
            <PersonalSettingsLink
              account={signedInAccount()}
              onOpen={() => settings.openAppSettings(serverSettings.serverSettingsRestoreTarget())}
            />
          }
        >
          <Show when={activeServer()}>
            {(server) => (
              <ServerSettingsLink
                server={server()}
                onOpen={() => serverSettings.openServerSettings(server().id, settings.appSettingsRestoreTarget())}
              />
            )}
          </Show>
        </Show>
      }
      onMounts={(mounts) => {
        content = mounts?.content;
        setContentElement(mounts?.content);
        nav = mounts?.nav;
        windowPage.setSettingsMounts(mounts);
      }}
      onEscape={() => {
        if (query()) setQuery("");
        else windowPage.showAgents();
      }}
      onClose={windowPage.showAgents}
    >
      <SettingsSearchField
        value={query()}
        onInput={setQuery}
        onEnter={() => {
          if (props.kind === "server") {
            openFirstSettingsSection(nav, windowPage.openFirstServerSection, query);
            return;
          }
          const top = results()?.[0];
          if (top) openResult(top);
        }}
      />
      <Show when={props.kind === "personal"}>
        <span class="sr-only" role="status">
          {resultStatus()}
        </span>
        <Show when={results()}>
          {(rows) => (
            <Show
              when={rows().length > 0}
              fallback={<p class="settings-page-empty">{i18n.t("app.settingsPage.noResults")}</p>}
            >
              <ul class="settings-page-results" aria-label={i18n.t("app.settingsPage.results")}>
                <For each={rows()}>
                  {(row) => {
                    const tab = "section" in row || "app" in row ? null : navItem(row.tab);
                    const marketplace = "app" in row;
                    const PlaceIcon = tab ? tab.icon : marketplace ? Store : Server;
                    const place = () =>
                      tab
                        ? i18n.t(tab.titleKey)
                        : marketplace
                          ? i18n.t("marketplace.title")
                          : (activeServer()?.name ?? "");
                    const titleKey =
                      "section" in row || "app" in row || row.anchor ? row.titleKey : navItem(row.tab).descriptionKey;
                    return (
                      <li>
                        <Button
                          variant="ghost"
                          type="button"
                          class="settings-page-result"
                          onClick={() => openResult(row)}
                        >
                          <span class="settings-page-result-section">
                            <PlaceIcon aria-hidden="true" />
                            {place()}
                          </span>
                          <span class="settings-page-result-title">{i18n.t(titleKey)}</span>
                        </Button>
                      </li>
                    );
                  }}
                </For>
              </ul>
            </Show>
          )}
        </Show>
      </Show>
    </SettingsPageFrame>
  );
}
