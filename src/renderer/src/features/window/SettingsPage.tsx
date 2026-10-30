import type { AppTextKey } from "@openbot/i18n";
import { Button, Input, Search } from "@openbot/ui";
import { createSignal, For, flush, Show } from "solid-js";
import { useI18n } from "../../i18n-context";
import { usePlatform } from "../../platform";
import { useServerSettings } from "../servers/server-settings";
import { useSettings } from "../settings/settings-context";
import {
  dynamicIslandSettingsShown,
  navItem,
  navItems,
  type SettingsTab,
  settingsTabShown,
} from "../settings/settings-tabs";
import { ServerSettingsPageTitle, SettingsPageFrame } from "./SettingsPageFrame";
import { type SettingsKind, useWindowPage } from "./window-page-context";

/** A search entry: a tab, or a row of a tab. A row has an anchor; a tab has none and opens at the top. */
type SearchRow = { tab: SettingsTab; titleKey: AppTextKey; descriptionKey?: AppTextKey; anchor?: AppTextKey };

/** Each personal tab, then its rows, in the order of the tab list. */
const SEARCH_ROWS: ReadonlyArray<SearchRow> = navItems.flatMap((item) => [
  { tab: item.value, titleKey: item.titleKey, descriptionKey: item.descriptionKey },
  ...item.rows.map((row) => ({ tab: item.value, ...row, anchor: row.titleKey })),
]);

/** A broad query shows a short list, not every row. */
const SEARCH_LIMIT = 12;

/**
 * The rows whose title or description holds the query. A title match comes first. `shown` tells
 * which tabs the settings panel shows on this computer.
 */
function rankRows(query: string, text: (key: AppTextKey) => string, shown: (tab: SettingsTab) => boolean): SearchRow[] {
  const needle = query.toLocaleLowerCase();
  const score = (row: SearchRow) => {
    const title = text(row.titleKey).toLocaleLowerCase();
    if (title.startsWith(needle)) return 0;
    if (title.includes(needle)) return 1;
    return row.descriptionKey && text(row.descriptionKey).toLocaleLowerCase().includes(needle) ? 2 : 3;
  };
  return SEARCH_ROWS.filter((row) => shown(row.tab))
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
  const platform = usePlatform();
  const [query, setQuery] = createSignal("");
  const tabShown = (tab: SettingsTab) =>
    settingsTabShown(tab, dynamicIslandSettingsShown(platform.appInfo()?.platform, platform.chatWindow !== null));
  const results = () => (query().trim() ? rankRows(query().trim(), (key) => i18n.t(key), tabShown) : null);
  /** What a screen reader hears while the user types a query. */
  const resultStatus = () => {
    const rows = results();
    if (!rows) return "";
    return rows.length > 0
      ? i18n.t("app.settingsPage.resultCount", { count: rows.length })
      : i18n.t("app.settingsPage.noResults");
  };
  let content: HTMLElement | undefined;

  /** Opens the tab of the result. For a row, it then scrolls to the row, marks it and puts the focus on its control. */
  const openResult = (row: SearchRow) => {
    setQuery("");
    // The modal applies a tab when the requested tab changes, so clear it first: a repeated tab opens again.
    settings.openAppSettings(null, undefined);
    flush();
    settings.openAppSettings(null, row.tab);
    flush();
    if (!content) return;
    for (const marked of content.querySelectorAll("[data-search-match]")) marked.removeAttribute("data-search-match");
    if (!row.anchor) return;
    // A row that the current state does not show has no anchor in the page; then only the tab opens.
    const anchor = content.querySelector(
      `.settings-modal-tab-panel[data-tab="${row.tab}"] [data-settings-row="${row.anchor}"]`,
    );
    // A switch row puts the anchor on its switch, so the search marks the whole row of the card.
    const target = anchor?.closest(".settings-modal-card > *") ?? anchor;
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
                    const tab = navItem(row.tab);
                    const TabIcon = tab.icon;
                    return (
                      <li>
                        <Button
                          variant="ghost"
                          type="button"
                          class="settings-page-result"
                          onClick={() => openResult(row)}
                        >
                          <span class="settings-page-result-section">
                            <TabIcon aria-hidden="true" />
                            {i18n.t(tab.titleKey)}
                          </span>
                          {/* A tab result shows the tab description, as its title is already on the line above. */}
                          <span class="settings-page-result-title">
                            {i18n.t(row.anchor ? row.titleKey : tab.descriptionKey)}
                          </span>
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
