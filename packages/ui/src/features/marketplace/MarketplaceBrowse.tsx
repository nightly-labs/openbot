import { Button, Heading, Input, Plus, Search, Text } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createEffect, For, Match, Show, Switch } from "solid-js";
import { AgentLibrary, agentFromSource } from "./MarketplaceAgents";
import { AppRow } from "./MarketplaceCards";
import { MissingNotice } from "./MarketplaceParts";
import { SkillLibrary } from "./MarketplaceSkills";
import { CATEGORY_LABELS } from "./marketplace-listing";
import {
  appCategories,
  MARKETPLACE_TABS,
  type MarketplaceScope,
  type MarketplaceTab,
  matchesApp,
} from "./marketplace-view";

const NO_MATCH = {
  agents: "marketplace.noMatch.agents",
  apps: "marketplace.noMatch.apps",
  skills: "marketplace.noMatch.skills",
} as const;

const EMPTY = {
  agents: "marketplace.empty.agents",
  apps: "marketplace.empty.apps",
  skills: "marketplace.empty.skills",
} as const;

const SHOW_TAB = {
  agents: "marketplace.noMatch.showAgents",
  apps: "marketplace.noMatch.showApps",
  skills: "marketplace.noMatch.showSkills",
} as const;

/** A tab with nothing to show: the filters hide it, the search finds nothing, or the catalog is empty. */
function NoMatch(props: {
  scope: MarketplaceScope;
  tab: MarketplaceTab;
  counts: () => Record<MarketplaceTab, number>;
  filtered: boolean;
  onClearFilters: () => void;
}) {
  const { t } = useText();
  const nav = () => props.scope.nav;
  const searching = () => nav().state.query.trim() !== "";
  const others = () => MARKETPLACE_TABS.filter((tab) => tab !== props.tab && props.counts()[tab] > 0);
  return (
    <div class="marketplace-empty">
      <Text as="p" variant="body-sm" tone="muted">
        {props.filtered ? t("marketplace.noMatch.filters") : searching() ? t(NO_MATCH[props.tab]) : t(EMPTY[props.tab])}
      </Text>
      <Show when={props.filtered || (searching() && others().length > 0)}>
        <div class="marketplace-empty-actions">
          <Show
            when={props.filtered}
            fallback={
              <For each={others()}>
                {(tab) => (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    data-cuelume-tap="select"
                    onClick={() =>
                      nav().set((draft) => {
                        draft.tab = tab;
                      })
                    }
                  >
                    {t(SHOW_TAB[tab], { count: props.counts()[tab] })}
                  </Button>
                )}
              </For>
            }
          >
            <Button type="button" variant="outline" size="sm" onClick={props.onClearFilters}>
              {t("marketplace.filter.clear")}
            </Button>
          </Show>
        </div>
      </Show>
    </div>
  );
}

/** The rows of each kind after the search and the filters, and their counts. The side panel shows the counts too. */
export function createBrowseLists(scope: MarketplaceScope) {
  const { format } = useText();
  const model = () => scope.model;
  const state = () => scope.nav.state;
  // A Worker before the `verified` filter sends every agent, so the list filters by source too.
  const agents = () => scope.agents.items().filter((listing) => agentFromSource(listing, state().agentSource));
  const skills = () => scope.skills.items();
  const apps = () =>
    model()
      .apps()
      .filter((app) => matchesApp(app, state().query));
  const counts = (): Record<MarketplaceTab, number> => ({
    agents: agents().length,
    apps: apps().length,
    skills: skills().length,
  });
  return {
    agents,
    skills,
    apps,
    counts,
    searching: () => state().query.trim() !== "",
    /** A listing that pages shows "50+" while the server holds more rows than the loaded ones. */
    countLabel: (tab: MarketplaceTab) => {
      const more = (tab === "agents" && scope.agents.hasMore()) || (tab === "skills" && scope.skills.hasMore());
      return `${format.number(counts()[tab])}${more ? "+" : ""}`;
    },
  };
}

export type BrowseLists = ReturnType<typeof createBrowseLists>;

/** The apps by category, in two columns of rows. */
function AppList(props: { scope: MarketplaceScope; lists: BrowseLists }) {
  const { t, format } = useText();
  return (
    <Show
      when={props.lists.apps().length > 0}
      fallback={
        <NoMatch
          scope={props.scope}
          tab="apps"
          counts={props.lists.counts}
          filtered={false}
          onClearFilters={() => undefined}
        />
      }
    >
      <For each={appCategories(props.lists.apps())} keyed={(group) => group.category}>
        {(group) => (
          <section class="marketplace-app-group" aria-labelledby={`marketplace-apps-${group().category}`}>
            <h4 id={`marketplace-apps-${group().category}`} class="marketplace-app-group-title">
              {t(CATEGORY_LABELS[group().category])}
              <span class="marketplace-app-group-count">{format.number(group().apps.length)}</span>
            </h4>
            {/* Each read of the host makes new app objects, so the rows are kept by id: the element
                under the pointer or the focus stays. */}
            <ul class="marketplace-app-list">
              <For each={group().apps} keyed={(app) => app.id}>
                {(app) => <AppRow scope={props.scope} app={app()} />}
              </For>
            </ul>
          </section>
        )}
      </For>
    </Show>
  );
}

/** The list of the kind that the side panel selected: its title and the search, then the rows. */
export function MarketplaceBrowse(props: { scope: MarketplaceScope; lists: BrowseLists }) {
  const { t } = useText();
  const model = () => props.scope.model;
  const nav = () => props.scope.nav;
  const state = () => props.scope.nav.state;

  /* "Your skills" and the agents of each skill row need each agent's skills. */
  createEffect(
    () => state().tab,
    (tab) => {
      if (tab === "skills") model().readSkills();
    },
  );

  const clearSkillSource = () =>
    nav().set((draft) => {
      draft.skillSource = null;
    });
  const clearAgentSource = () =>
    nav().set((draft) => {
      draft.agentSource = null;
    });

  return (
    <Switch>
      <Match when={state().tab === "skills"}>
        <SkillLibrary
          scope={props.scope}
          noMatch={
            <NoMatch
              scope={props.scope}
              tab="skills"
              counts={props.lists.counts}
              filtered={state().skillSource !== null}
              onClearFilters={clearSkillSource}
            />
          }
        />
      </Match>
      <Match when={state().tab === "agents"}>
        <AgentLibrary
          scope={props.scope}
          noMatch={
            <NoMatch
              scope={props.scope}
              tab="agents"
              counts={props.lists.counts}
              filtered={state().agentSource !== null}
              onClearFilters={clearAgentSource}
            />
          }
        />
      </Match>
      <Match when={state().tab === "apps"}>
        <div class="marketplace-view marketplace-browse">
          <header class="marketplace-browse-head">
            <div class="marketplace-browse-copy">
              <Heading as="h3" size="lg" class="marketplace-browse-title">
                {t("marketplace.tab.apps")}
              </Heading>
              <Text as="p" variant="body" tone="muted">
                {t("marketplace.description.apps")}
              </Text>
            </div>
            <div class="marketplace-toolbar">
              <label class="search-field marketplace-search">
                <Search aria-hidden="true" />
                <Input
                  type="search"
                  aria-label={t("marketplace.search.label")}
                  placeholder={t("marketplace.search.placeholder")}
                  value={state().query}
                  onInput={(event) => {
                    const value = event.currentTarget.value;
                    nav().set((draft) => {
                      draft.query = value;
                    });
                  }}
                />
              </label>
              <Show when={model().addServer}>
                {(add) => (
                  <Button type="button" size="sm" onClick={() => add()()}>
                    <Plus aria-hidden="true" />
                    {t("marketplace.app.addCustom")}
                  </Button>
                )}
              </Show>
            </div>
          </header>
          <div class="marketplace-stack">
            <Show when={state().missingApp}>
              <MissingNotice>{t("marketplace.plugins.missing")}</MissingNotice>
            </Show>
            <AppList scope={props.scope} lists={props.lists} />
          </div>
        </div>
      </Match>
    </Switch>
  );
}
