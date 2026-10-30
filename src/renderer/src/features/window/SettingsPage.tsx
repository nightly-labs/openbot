import type { AppTextKey } from "@openbot/i18n";
import { Button, Input, Search, Server } from "@openbot/ui";
import { createSignal, For, flush, Show } from "solid-js";
import { useI18n } from "../../i18n-context";
import type { ServerSettingsSection } from "../servers/ServerSettingsModal";
import { activeServerHasProviderSettings, serverSupportsCapability } from "../servers/server-capabilities";
import { useServerSettings } from "../servers/server-settings";
import { useServers } from "../servers/servers-context";
import { useSettings } from "../settings/settings-context";
import { navItem, type SettingsTab } from "../settings/settings-tabs";
import { ServerSettingsPageTitle, SettingsPageFrame } from "./SettingsPageFrame";
import { type SettingsKind, useWindowPage } from "./window-page-context";

type PersonalRow = { tab: SettingsTab; titleKey: AppTextKey; descriptionKey: AppTextKey };

/** A section of the active server's settings. A user looks for providers in the user settings too. */
type ServerRow = { section: ServerSettingsSection; titleKey: AppTextKey; descriptionKey: AppTextKey };

/** The row titles of each personal tab, in page order, with the description that the search also reads. */
const SEARCH_ROWS: PersonalRow[] = [
  { tab: "general", titleKey: "settings.language.title", descriptionKey: "settings.language.description" },
  { tab: "general", titleKey: "settings.logoColor.title", descriptionKey: "settings.logoColor.description" },
  { tab: "general", titleKey: "settings.sendShortcut.title", descriptionKey: "settings.sendShortcut.description" },
  { tab: "general", titleKey: "settings.busyMessage.title", descriptionKey: "settings.busyMessage.description" },
  {
    tab: "general",
    titleKey: "settings.agentMemoryLimit.title",
    descriptionKey: "settings.agentMemoryLimit.description",
  },
  { tab: "general", titleKey: "settings.externalLinks.title", descriptionKey: "settings.externalLinks.description" },
  { tab: "general", titleKey: "settings.launchAtLogin.title", descriptionKey: "settings.launchAtLogin.description" },
  {
    tab: "general",
    titleKey: "settings.keepRemoteSessions.title",
    descriptionKey: "settings.keepRemoteSessions.description",
  },
  { tab: "general", titleKey: "settings.keepRunning.title", descriptionKey: "settings.keepRunning.description" },
  {
    tab: "general",
    titleKey: "settings.restoreWorkspace.title",
    descriptionKey: "settings.restoreWorkspace.description",
  },
  { tab: "general", titleKey: "settings.analytics.title", descriptionKey: "settings.analytics.description" },
  {
    tab: "notifications",
    titleKey: "settings.desktopNotifications.title",
    descriptionKey: "settings.desktopNotifications.description",
  },
  {
    tab: "notifications",
    titleKey: "settings.notificationPreview.title",
    descriptionKey: "settings.notificationPreview.description",
  },
  {
    tab: "notifications",
    titleKey: "settings.testNotification.title",
    descriptionKey: "settings.testNotification.description",
  },
  { tab: "notifications", titleKey: "settings.taskSound.title", descriptionKey: "settings.taskSound.description" },
  {
    tab: "notifications",
    titleKey: "settings.soundFeedback.title",
    descriptionKey: "settings.soundFeedback.description",
  },
];

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

/** A broad query shows a short list, not every row. */
const SEARCH_LIMIT = 12;

type SearchRow = PersonalRow | ServerRow;

/** The rows whose title or description holds the query. A title match comes first. */
function rankRows(query: string, rows: SearchRow[], text: (key: AppTextKey) => string): SearchRow[] {
  const needle = query.toLocaleLowerCase();
  const score = (row: SearchRow) => {
    const title = text(row.titleKey).toLocaleLowerCase();
    if (title.startsWith(needle)) return 0;
    if (title.includes(needle)) return 1;
    return text(row.descriptionKey).toLocaleLowerCase().includes(needle) ? 2 : 3;
  };
  return rows
    .map((row) => ({ row, rank: score(row) }))
    .filter((entry) => entry.rank < 3)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, SEARCH_LIMIT)
    .map((entry) => entry.row);
}

/**
 * A settings page of the window: the user settings or the settings of the active server. The settings
 * panel shows its nav and content in the mounts of this page. On the user settings page, the search
 * above the nav replaces the nav with matching rows. A result opens its tab and moves to its row.
 */
export function SettingsPage(props: { kind: SettingsKind }) {
  const i18n = useI18n();
  const windowPage = useWindowPage();
  const settings = useSettings();
  const serverSettings = useServerSettings();
  const { activeServer } = useServers();
  const [query, setQuery] = createSignal("");
  /** The personal rows, then the sections that the settings of the active server show. */
  const searchRows = (): SearchRow[] => {
    const server = activeServer();
    if (!server) return SEARCH_ROWS;
    return [
      ...SEARCH_ROWS,
      ...(activeServerHasProviderSettings(server) ? [PROVIDERS_ROW] : []),
      ...(serverSupportsCapability(server, "agent-import-v1") ? [IMPORT_ROW] : []),
    ];
  };
  const results = () => (query().trim() ? rankRows(query().trim(), searchRows(), (key) => i18n.t(key)) : null);
  /** What a screen reader hears while the user types a query. */
  const resultStatus = () => {
    const rows = results();
    if (!rows) return "";
    return rows.length > 0
      ? i18n.t("app.settingsPage.resultCount", { count: rows.length })
      : i18n.t("app.settingsPage.noResults");
  };
  let content: HTMLElement | undefined;

  /**
   * Opens the tab of the row, then scrolls to the row, marks it and puts the focus on its control. A
   * server row opens that section of the active server's settings.
   */
  const openResult = (row: SearchRow) => {
    setQuery("");
    if ("section" in row) {
      const server = activeServer();
      if (server) serverSettings.openServerSettings(server.id, null, row.section);
      return;
    }
    // The modal applies a tab when the requested tab changes, so clear it first: a repeated tab opens again.
    settings.openAppSettings(null, undefined);
    flush();
    settings.openAppSettings(null, row.tab);
    flush();
    if (!content) return;
    const title = i18n.t(row.titleKey);
    for (const marked of content.querySelectorAll("[data-search-match]")) marked.removeAttribute("data-search-match");
    const label = [...content.querySelectorAll(".settings-modal-page .settings-modal-tab-panel *")].find(
      (element) => element.childElementCount === 0 && element.textContent?.trim() === title,
    );
    const target = label?.closest(".settings-modal-card > *") ?? label;
    if (!(target instanceof HTMLElement)) return;
    target.setAttribute("data-search-match", "");
    target.scrollIntoView({ block: "center" });
    target.querySelector<HTMLElement>("button, input, select, [tabindex]")?.focus({ preventScroll: true });
  };

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
      onMounts={(mounts) => {
        content = mounts?.content;
        windowPage.setSettingsMounts(mounts);
      }}
      // Escape clears the search, or else closes the page.
      onEscape={() => {
        if (query()) setQuery("");
        else windowPage.showAgents();
      }}
    >
      <Show when={props.kind === "personal"}>
        <label class="search-field settings-page-search">
          <Search aria-hidden="true" />
          <Input
            type="search"
            aria-label={i18n.t("app.settingsPage.search")}
            placeholder={i18n.t("app.settingsPage.searchPlaceholder")}
            spellcheck={false}
            value={query()}
            onInput={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              const top = results()?.[0];
              if (event.key === "Enter" && top) {
                event.preventDefault();
                openResult(top);
              }
            }}
          />
        </label>
        {/* Always in the page, so a screen reader announces each change of the count. */}
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
                    // A server row names the server, as the server rows of the command palette do.
                    const PlaceIcon = "section" in row ? Server : navItem(row.tab).icon;
                    const place = () =>
                      "section" in row ? (activeServer()?.name ?? "") : i18n.t(navItem(row.tab).titleKey);
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
                          <span class="settings-page-result-title">{i18n.t(row.titleKey)}</span>
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
