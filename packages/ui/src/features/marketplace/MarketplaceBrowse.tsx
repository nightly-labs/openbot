import { SKILL_CATEGORIES, type SkillCategory } from "@openbot/contracts/ipc";
import { Button, Input, Search, Skeleton, SlidingTabs, Text } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { createEffect, For, Show } from "solid-js";
import { AgentGrid, AppCard, SkillGrid } from "./MarketplaceCards";
import { type FilterGroup, MarketplaceFilter } from "./MarketplaceFilter";
import { skillAgents } from "./MarketplaceInstallSkill";
import { Block } from "./MarketplaceParts";
import { CATEGORY_LABELS, type MarketplaceListing } from "./marketplace-listing";
import {
  appGroups,
  isMarketplaceTab,
  type MarketplaceScope,
  type MarketplaceTab,
  matchesApp,
  type OwnedFilter,
} from "./marketplace-view";

const TABS: readonly MarketplaceTab[] = ["agents", "apps", "skills"];

const TAB_LABEL = {
  agents: "marketplace.tab.agents",
  apps: "marketplace.tab.apps",
  skills: "marketplace.tab.skills",
} as const;

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

function ownedOf(value: string | null): OwnedFilter | null {
  return value === "yes" || value === "no" ? value : null;
}

function categoryOf(value: string | null): SkillCategory | null {
  return SKILL_CATEGORIES.find((category) => category === value) ?? null;
}

function owns(owned: OwnedFilter | null, have: boolean) {
  return owned === null || (owned === "yes") === have;
}

/** A tab with nothing to show: the filters hide it, the search finds nothing, or the catalog is empty. */
function NoMatch(props: {
  scope: MarketplaceScope;
  tab: MarketplaceTab;
  counts: Record<MarketplaceTab, number>;
  filtered: boolean;
  onClearFilters: () => void;
}) {
  const { t } = useText();
  const nav = () => props.scope.nav;
  const searching = () => nav().state.query.trim() !== "";
  const others = () => TABS.filter((tab) => tab !== props.tab && props.counts[tab] > 0);
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
                    {t(SHOW_TAB[tab], { count: props.counts[tab] })}
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

/** A listing's first load, its failure, its rows, and "Load more" while the server has more. */
function ListingPanel(props: {
  listing: MarketplaceListing<unknown>;
  loadingLabel: string;
  count: number;
  empty: JSX.Element;
  children: JSX.Element;
}) {
  const { t } = useText();
  const failure = () => (
    <div class="marketplace-empty" role="alert">
      <Text as="p" variant="body-sm" tone="muted">
        {props.listing.error()}
      </Text>
      <Button type="button" variant="outline" size="sm" onClick={props.listing.retry}>
        {t("common.retry")}
      </Button>
    </div>
  );
  return (
    <Show
      when={!props.listing.loading()}
      fallback={
        <div class="marketplace-grid" role="status" aria-label={props.loadingLabel}>
          <For each={Array.from({ length: 6 }, (_, index) => index)}>
            {() => (
              <div class="marketplace-card marketplace-card-skeleton" aria-hidden="true">
                <Skeleton class="marketplace-skeleton-mark" />
                <Skeleton class="marketplace-skeleton-line" />
                <Skeleton class="marketplace-skeleton-line" />
              </div>
            )}
          </For>
        </div>
      }
    >
      {/* A failed "Load more" keeps the rows that loaded. */}
      <Show when={!props.listing.error() || props.count > 0} fallback={failure()}>
        <div class="marketplace-stack">
          <Show when={props.count > 0 || props.listing.pending()} fallback={props.empty}>
            {props.children}
          </Show>
          <Show when={!props.listing.error()} fallback={failure()}>
            {/* A filter can hide each loaded row while a later page still holds a match. */}
            <Show when={props.listing.hasMore()}>
              <Button
                type="button"
                variant="outline"
                class="marketplace-load-more"
                data-cuelume-tap="navigate"
                loading={props.listing.loadingMore()}
                onClick={props.listing.loadMore}
              >
                {t("marketplace.loadMore")}
              </Button>
            </Show>
          </Show>
        </div>
      </Show>
    </Show>
  );
}

export function MarketplaceBrowse(props: { scope: MarketplaceScope }) {
  const { t, format } = useText();
  const model = () => props.scope.model;
  const nav = () => props.scope.nav;
  const state = () => props.scope.nav.state;
  const searching = () => state().query.trim() !== "";

  const agents = () =>
    props.scope.agents
      .items()
      .filter((listing) => owns(state().agentsOwned, (model().agentState(listing) ?? "add") !== "add"));
  const skills = () =>
    props.scope.skills.items().filter((skill) => owns(state().skillsOwned, skillAgents(props.scope, skill).length > 0));
  const apps = () =>
    model()
      .apps()
      .filter((app) => matchesApp(app, state().query));
  const counts = (): Record<MarketplaceTab, number> => ({
    agents: agents().length,
    apps: apps().length,
    skills: skills().length,
  });
  /** A listing that pages shows "50+" while the server holds more rows than the loaded ones. */
  const countLabel = (tab: MarketplaceTab) => {
    const more =
      (tab === "agents" && props.scope.agents.hasMore()) || (tab === "skills" && props.scope.skills.hasMore());
    return `${format.number(counts()[tab])}${more ? "+" : ""}`;
  };

  /* The Installed filter and the install buttons need each agent's skills. */
  createEffect(
    () => state().tab,
    (tab) => {
      if (tab === "skills") model().readSkills();
    },
  );

  const categoryOptions = () =>
    SKILL_CATEGORIES.map((category) => ({ value: category, label: t(CATEGORY_LABELS[category]) }));
  const agentGroups = (): FilterGroup[] => [
    /* A chosen status stays in the menu, so that the user can clear it. */
    ...(state().agentsOwned !== null || props.scope.agents.items().some((item) => model().agentState(item) !== null)
      ? [
          {
            legend: t("marketplace.filter.status"),
            options: [
              { value: "yes", label: t("marketplace.filter.added") },
              { value: "no", label: t("marketplace.filter.notAdded") },
            ],
            value: state().agentsOwned,
            set: (value: string | null) =>
              nav().set((draft) => {
                draft.agentsOwned = ownedOf(value);
              }),
          },
        ]
      : []),
    {
      legend: t("marketplace.filter.category"),
      options: categoryOptions(),
      value: state().agentCategory,
      set: (value) =>
        nav().set((draft) => {
          draft.agentCategory = categoryOf(value);
        }),
    },
  ];
  const skillGroups = (): FilterGroup[] => [
    ...(model().agents().length > 0
      ? [
          {
            legend: t("marketplace.filter.status"),
            options: [
              { value: "yes", label: t("marketplace.filter.installed") },
              { value: "no", label: t("marketplace.filter.notInstalled") },
            ],
            value: state().skillsOwned,
            set: (value: string | null) =>
              nav().set((draft) => {
                draft.skillsOwned = ownedOf(value);
              }),
          },
        ]
      : []),
    {
      legend: t("marketplace.filter.category"),
      options: categoryOptions(),
      value: state().skillCategory,
      set: (value) =>
        nav().set((draft) => {
          draft.skillCategory = categoryOf(value);
        }),
    },
  ];
  const agentsFiltered = () => state().agentCategory !== null || state().agentsOwned !== null;
  const skillsFiltered = () => state().skillCategory !== null || state().skillsOwned !== null;
  const clearFilters = (tab: MarketplaceTab) =>
    nav().set((draft) => {
      if (tab === "agents") {
        draft.agentCategory = null;
        draft.agentsOwned = null;
      } else {
        draft.skillCategory = null;
        draft.skillsOwned = null;
      }
    });

  return (
    <div class="marketplace-view">
      <SlidingTabs.Root
        value={state().tab}
        onChange={(value: string) =>
          nav().set((draft) => {
            draft.tab = isMarketplaceTab(value) ? value : "agents";
          })
        }
      >
        <div class="marketplace-toolbar">
          <SlidingTabs.List aria-label={t("marketplace.kinds")}>
            <For each={TABS}>
              {(tab) => (
                <SlidingTabs.Trigger value={tab}>
                  {t(TAB_LABEL[tab])}
                  <Show when={searching()}>
                    <span class="marketplace-count">{countLabel(tab)}</span>
                  </Show>
                </SlidingTabs.Trigger>
              )}
            </For>
          </SlidingTabs.List>
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
          <Show when={state().tab === "agents"}>
            <MarketplaceFilter groups={agentGroups()} />
          </Show>
          <Show when={state().tab === "skills"}>
            <MarketplaceFilter groups={skillGroups()} />
          </Show>
        </div>
        <SlidingTabs.ContentSlot class="marketplace-tab-slot">
          <SlidingTabs.Content value="agents">
            <ListingPanel
              listing={props.scope.agents}
              loadingLabel={t("marketplace.loading.agents")}
              count={agents().length}
              empty={
                <NoMatch
                  scope={props.scope}
                  tab="agents"
                  counts={counts()}
                  filtered={agentsFiltered()}
                  onClearFilters={() => clearFilters("agents")}
                />
              }
            >
              <AgentGrid scope={props.scope} items={agents()} />
            </ListingPanel>
          </SlidingTabs.Content>
          <SlidingTabs.Content value="apps">
            <div class="marketplace-stack">
              <Show when={state().missingApp}>
                <div class="marketplace-empty" role="alert">
                  <Text as="p" variant="body-sm" tone="muted">
                    {t("marketplace.plugins.missing")}
                  </Text>
                </div>
              </Show>
              <Show
                when={apps().length > 0}
                fallback={
                  <NoMatch
                    scope={props.scope}
                    tab="apps"
                    counts={counts()}
                    filtered={false}
                    onClearFilters={() => undefined}
                  />
                }
              >
                {/* Each read of the host makes new app objects, so the cards are kept by id: the
                    element under the pointer or the focus stays. */}
                <For each={appGroups(apps())} keyed={(group) => group.id}>
                  {(group) => (
                    <Block id={group().id} level="h3" title={t(group().key)}>
                      <div class="marketplace-grid">
                        <For each={group().apps} keyed={(app) => app.id}>
                          {(app) => <AppCard scope={props.scope} app={app()} />}
                        </For>
                      </div>
                    </Block>
                  )}
                </For>
              </Show>
            </div>
          </SlidingTabs.Content>
          <SlidingTabs.Content value="skills">
            <ListingPanel
              listing={props.scope.skills}
              loadingLabel={t("marketplace.loading.skills")}
              count={skills().length}
              empty={
                <NoMatch
                  scope={props.scope}
                  tab="skills"
                  counts={counts()}
                  filtered={skillsFiltered()}
                  onClearFilters={() => clearFilters("skills")}
                />
              }
            >
              <SkillGrid scope={props.scope} items={skills()} />
            </ListingPanel>
          </SlidingTabs.Content>
        </SlidingTabs.ContentSlot>
      </SlidingTabs.Root>
    </div>
  );
}
