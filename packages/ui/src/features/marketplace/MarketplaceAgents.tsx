import { type MarketplaceAgentSummary, SKILL_CATEGORIES, type SkillCategory } from "@openbot/contracts/ipc";
import { Badge, Button, Heading, Plus, Text } from "@openbot/ui";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import { useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { createEffect, createMemo, createStore, For, Match, onCleanup, Show, Switch, untrack } from "solid-js";
import { Done, ListingPanel, MissingNotice } from "./MarketplaceParts";
import { GroupHead, MarketplaceSearch, SourceSwitch, VerifiedMark } from "./MarketplaceSkills";
import { CATEGORY_LABELS, createMarketplaceListing } from "./marketplace-listing";
import type { MarketplaceModel } from "./marketplace-model";
import {
  type MarketplaceNavigation,
  type MarketplaceScope,
  type SkillSource,
  sourceVerified,
} from "./marketplace-view";

/** A group on the Agents tab shows this many agents. "See all" opens the category on its own page. */
const GROUP_LIMIT = 6;
/** The featured cards of the Agents tab and of a category page. */
const FEATURED_LIMIT = 3;

const categoryOf = (listing: MarketplaceAgentSummary): SkillCategory => listing.category ?? "other";

/**
 * Whether an agent is of the chosen source. The catalog query sends the source too, but a Worker that
 * does not read it sends each agent.
 */
export function agentFromSource(listing: MarketplaceAgentSummary, source: SkillSource | null): boolean {
  return source === null || (listing.verified === true) === (source === "verified");
}

/** The user has the agent. A member, who can add no agent, has none. */
function owned(model: MarketplaceModel, listing: MarketplaceAgentSummary) {
  return (model.agentState(listing) ?? "add") !== "add";
}

/** The catalog's own picks first, then the agents with the most installs. */
function byFeatured(from: readonly MarketplaceAgentSummary[]) {
  return [...from].sort(
    (left, right) => Number(right.featured) - Number(left.featured) || right.installs - left.installs,
  );
}

/**
 * An add moves the agent into "Your agents", so the focus goes to its row there after the render. A
 * category page has no such row; the focus then goes to the page heading.
 */
function focusRow(label: string) {
  requestAnimationFrame(() => {
    const view = document.querySelector(".skills-marketplace .marketplace-view");
    const row = view?.querySelector<HTMLElement>(`.marketplace-app-row-hit[aria-label="${CSS.escape(label)}"]`);
    (row ?? view?.querySelector<HTMLElement>("h3[tabindex]"))?.focus();
  });
}

/** "2 skills · 1 routine": what the agent brings with it. */
function useContents() {
  const { t } = useText();
  return (listing: MarketplaceAgentSummary) =>
    [
      t("marketplace.skills.count", { count: listing.skillCount }),
      ...(listing.routineCount > 0 ? [t("marketplace.agents.routineCount", { count: listing.routineCount })] : []),
    ].join(" · ");
}

/** "Add", "Added", or "Update available" in a catalog row; "Open chat" or "Update" in a row of the user's. */
function AgentAction(props: {
  scope: MarketplaceScope;
  listing: MarketplaceAgentSummary;
  yours?: boolean | undefined;
  /** The button is gone after an add, so the focus needs a new place. */
  onAdded: () => void;
}) {
  const { t } = useText();
  const model = () => props.scope.model;
  const state = () => model().agentState(props.listing);
  const busy = () => model().agentBusy(props.listing.id);
  return (
    <Switch>
      <Match when={state() === "add"}>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          loading={busy()}
          aria-label={t("marketplace.agent.addNamed", { name: props.listing.name })}
          onClick={() =>
            void model()
              .addAgent(props.listing)
              .then((added) => {
                if (added) props.onAdded();
              })
          }
        >
          <Plus aria-hidden="true" />
          {t("marketplace.agent.add")}
        </Button>
      </Match>
      <Match when={state() === "update" && props.yours}>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          loading={busy()}
          onClick={() => void model().addAgent(props.listing, true)}
        >
          {t("marketplace.agent.update")}
        </Button>
      </Match>
      <Match when={state() === "update"}>
        <Badge variant="info-light">{t("marketplace.agent.updateAvailable")}</Badge>
      </Match>
      <Match when={state() === "added" && props.yours}>
        <Button type="button" variant="outline" size="sm" onClick={() => model().openChat(props.listing.id)}>
          {t("marketplace.agent.openChat")}
        </Button>
      </Match>
      <Match when={state() === "added"}>
        <Done>{t("marketplace.agent.added")}</Done>
      </Match>
    </Switch>
  );
}

/**
 * One agent as an app row: avatar, name, creator, one line, and its action. The row opens the agent
 * page. The creator shows, as on the public page, so a copy of an agent's name does not pass for it.
 */
function AgentRow(props: { scope: MarketplaceScope; listing: MarketplaceAgentSummary; yours?: boolean | undefined }) {
  const { t } = useText();
  const open = () => t("marketplace.open", { name: props.listing.name });
  /** A row of the user's says that a newer version waits. */
  const attention = () => props.yours === true && props.scope.model.agentState(props.listing) === "update";
  const line = () => (attention() ? t("marketplace.agent.updateAvailable") : props.listing.title);
  return (
    <li class="marketplace-app-row marketplace-agent-row">
      <Button
        type="button"
        variant="ghost"
        class="marketplace-app-row-hit"
        data-cuelume-tap="navigate"
        aria-label={open()}
        onClick={() => props.scope.nav.go({ kind: "agent", listing: props.listing })}
      />
      <span class="marketplace-avatar" data-size="md">
        <AgentAvatar agent={props.listing} motion="hover" />
      </span>
      <span class="marketplace-app-row-copy">
        <span class="marketplace-skill-name">
          <span class="marketplace-app-row-name">{props.listing.name}</span>
          <VerifiedMark on={props.listing.verified === true} />
          <span class="marketplace-agent-by">{t("marketplace.agents.by", { name: props.listing.creatorName })}</span>
        </span>
        <span class={{ "marketplace-app-row-tagline": true, "marketplace-skill-attention": attention() }}>
          {line()}
        </span>
      </span>
      <span class="marketplace-app-row-status">
        <AgentAction scope={props.scope} listing={props.listing} yours={props.yours} onAdded={() => focusRow(open())} />
      </span>
    </li>
  );
}

function AgentRows(props: { scope: MarketplaceScope; agents: readonly MarketplaceAgentSummary[]; yours?: boolean }) {
  return (
    <ul class="marketplace-app-list">
      <For each={props.agents} keyed={(listing) => listing.id}>
        {(listing) => <AgentRow scope={props.scope} listing={listing()} yours={props.yours} />}
      </For>
    </ul>
  );
}

/**
 * A featured agent: its avatar and Add on one line, its name and creator, what it does, and what it
 * brings, as a featured card on the public page.
 */
function FeatureCard(props: { scope: MarketplaceScope; listing: MarketplaceAgentSummary }) {
  const { t } = useText();
  const contents = useContents();
  const id = () => `marketplace-agent-feature-${props.listing.id}`;
  const open = () => t("marketplace.open", { name: props.listing.name });
  return (
    <article class="marketplace-card marketplace-agent-feature" aria-labelledby={id()}>
      <Button
        type="button"
        variant="ghost"
        class="marketplace-hitarea"
        data-cuelume-tap="navigate"
        aria-label={open()}
        onClick={() => props.scope.nav.go({ kind: "agent", listing: props.listing })}
      />
      <div class="marketplace-card-head">
        <span class="marketplace-avatar" data-size="lg">
          <AgentAvatar agent={props.listing} motion="hover" />
        </span>
        <div class="marketplace-card-action">
          <AgentAction scope={props.scope} listing={props.listing} onAdded={() => focusRow(open())} />
        </div>
      </div>
      <div class="marketplace-agent-feature-copy">
        <Heading as="h5" size="sm" class="marketplace-card-name" id={id()}>
          {props.listing.name}
          <VerifiedMark on={props.listing.verified === true} />
        </Heading>
        <Text as="span" variant="caption" tone="muted">
          {t("marketplace.agents.by", { name: props.listing.creatorName })}
        </Text>
      </div>
      <Text as="p" variant="body-sm" class="marketplace-card-body">
        {props.listing.description}
      </Text>
      <div class="marketplace-card-foot">
        <Text as="span" variant="caption" tone="muted">
          {contents(props.listing)}
        </Text>
      </div>
    </article>
  );
}

/** Three cards under one title. On the Agents tab the shelf is one more group, with the same line above it. */
function FeatureShelf(props: { scope: MarketplaceScope; agents: readonly MarketplaceAgentSummary[]; group?: boolean }) {
  const { t } = useText();
  return (
    <section
      class={{ "marketplace-skill-featured": true, "marketplace-app-group": props.group === true }}
      aria-labelledby="marketplace-agents-featured"
    >
      <h4 id="marketplace-agents-featured" class="marketplace-app-group-title">
        {t("marketplace.skills.featured")}
      </h4>
      <div class="marketplace-skill-featured-grid">
        <For each={props.agents} keyed={(listing) => listing.id}>
          {(listing) => <FeatureCard scope={props.scope} listing={listing()} />}
        </For>
      </div>
    </section>
  );
}

/**
 * The featured agents of the Agents tab or of one category: the catalog's own picks with the most
 * installs. With no pick, or after a failed read, the loaded agents: the featured ones first, then the
 * most installed. The user has none of them. A search hides them.
 */
function createFeaturedAgents(
  scope: MarketplaceScope,
  category: SkillCategory | undefined,
  available: () => readonly MarketplaceAgentSummary[],
) {
  const [state, setState] = createStore<{ picks: MarketplaceAgentSummary[] }>({ picks: [] });
  let version = 0;
  onCleanup(() => {
    version++;
  });
  createEffect(
    () => sourceVerified(scope.nav.state.agentSource),
    (verified) => {
      const current = ++version;
      void untrack(() =>
        scope.model.listAgents({
          featured: true,
          ...(category ? { category } : {}),
          ...(verified === undefined ? {} : { verified }),
          sort: "installs",
          limit: FEATURED_LIMIT,
        }),
      ).then(
        (page) => {
          if (current === version)
            setState((draft) => {
              draft.picks = page.items;
            });
        },
        () => {
          if (current === version)
            setState((draft) => {
              draft.picks = [];
            });
        },
      );
    },
  );
  return createMemo(() => {
    if (scope.nav.state.query.trim() !== "") return [];
    const source = scope.nav.state.agentSource;
    const picks = state.picks.filter((listing) => agentFromSource(listing, source) && !owned(scope.model, listing));
    if (picks.length > 0) return picks.slice(0, FEATURED_LIMIT);
    return byFeatured(available()).slice(0, FEATURED_LIMIT);
  });
}

/** The title of the Agents tab or of a category page, and the source switch at its end. */
function AgentsHead(props: { nav: MarketplaceNavigation; title: string; description?: string | undefined }) {
  return (
    <div class="marketplace-skill-head-row">
      <div class="marketplace-browse-copy">
        <Heading as="h3" size="lg" class="marketplace-browse-title">
          {props.title}
        </Heading>
        <Show when={props.description}>
          {(description) => (
            <Text as="p" variant="body" tone="muted">
              {description()}
            </Text>
          )}
        </Show>
      </div>
      <SourceSwitch
        value={props.nav.state.agentSource}
        onChange={(source) =>
          props.nav.set((draft) => {
            draft.agentSource = source;
          })
        }
      />
    </div>
  );
}

/**
 * The Agents tab: "Your agents" first, with Open chat or Update in each row; the featured agents; then
 * the agents that the user does not have, by category. Each category shows its first 6 agents, also
 * during a search; "See all" opens the category page.
 */
export function AgentLibrary(props: { scope: MarketplaceScope; noMatch: JSX.Element }) {
  const { t } = useText();
  const nav = () => props.scope.nav;
  const model = () => props.scope.model;
  /* The listing holds the search. The source goes to the server too, and is checked here. */
  const found = createMemo(() =>
    props.scope.agents.items().filter((listing) => agentFromSource(listing, nav().state.agentSource)),
  );
  const mine = createMemo(() => found().filter((listing) => owned(model(), listing)));
  const available = createMemo(() => found().filter((listing) => !owned(model(), listing)));
  const byCategory = createMemo(() =>
    SKILL_CATEGORIES.flatMap((category) => {
      const agents = available().filter((listing) => categoryOf(listing) === category);
      return agents.length > 0 ? [{ category, agents }] : [];
    }),
  );
  const featured = createFeaturedAgents(props.scope, undefined, available);
  /* The server can hold more agents of a category than the first page brought. */
  const more = (agents: readonly MarketplaceAgentSummary[]) =>
    agents.length > GROUP_LIMIT || props.scope.agents.hasMore();
  return (
    <div class="marketplace-view marketplace-browse">
      <header class="marketplace-browse-head">
        <AgentsHead nav={nav()} title={t("marketplace.tab.agents")} description={t("marketplace.description.agents")} />
        <div class="marketplace-toolbar">
          <MarketplaceSearch nav={nav()} />
        </div>
      </header>
      <div class="marketplace-stack">
        <Show when={nav().state.missingListing === "agent"}>
          <MissingNotice>{t("marketplace.agents.missing")}</MissingNotice>
        </Show>
        <ListingPanel
          listing={props.scope.agents}
          loadingLabel={t("marketplace.loading.agents")}
          count={found().length}
          paged={false}
          empty={props.noMatch}
        >
          <Show when={mine().length > 0}>
            <section class="marketplace-app-group" aria-labelledby="marketplace-agents-yours">
              <GroupHead
                id="marketplace-agents-yours"
                label={t("marketplace.agents.yours")}
                count={mine().length}
                more={false}
                onSeeAll={() => undefined}
              />
              <AgentRows scope={props.scope} agents={mine()} yours />
            </section>
          </Show>
          <Show when={featured().length > 0}>
            <FeatureShelf scope={props.scope} agents={featured()} group />
          </Show>
          <For each={byCategory()} keyed={(group) => group.category}>
            {(group) => (
              <section class="marketplace-app-group" aria-labelledby={`marketplace-agents-${group().category}`}>
                <GroupHead
                  id={`marketplace-agents-${group().category}`}
                  label={t(CATEGORY_LABELS[group().category])}
                  more={more(group().agents)}
                  onSeeAll={() => nav().go({ kind: "agentGroup", category: group().category })}
                />
                <AgentRows scope={props.scope} agents={group().agents.slice(0, GROUP_LIMIT)} />
              </section>
            )}
          </For>
        </ListingPanel>
      </div>
    </div>
  );
}

/**
 * One category on its own page, from the server in pages: three featured cards, so the page does not
 * start as a flat list, then the rest in two columns. A search hides the cards. The search stays at
 * the top while the list scrolls.
 */
export function AgentGroupPage(props: { scope: MarketplaceScope; category: SkillCategory }) {
  const { t } = useText();
  const category = untrack(() => props.category);
  const nav = () => props.scope.nav;
  const model = () => props.scope.model;
  const label = () => t(CATEGORY_LABELS[category]);
  const listing = createMarketplaceListing({
    list: (query) => model().listAgents(query),
    query: () => nav().state.query,
    category: () => category,
    verified: () => sourceVerified(nav().state.agentSource),
  });
  const available = createMemo(() =>
    listing.items().filter((agent) => agentFromSource(agent, nav().state.agentSource) && !owned(model(), agent)),
  );
  const featured = createFeaturedAgents(props.scope, category, available);
  const rest = createMemo(() => {
    const above = new Set(featured().map((agent) => agent.id));
    return available().filter((agent) => !above.has(agent.id));
  });
  return (
    <div class="marketplace-view marketplace-browse marketplace-skill-group-page">
      <header>
        <AgentsHead nav={nav()} title={label()} />
      </header>
      <div class="marketplace-toolbar marketplace-skill-group-bar">
        <MarketplaceSearch nav={nav()} label={t("marketplace.skills.searchIn", { name: label() })} />
      </div>
      <ListingPanel
        listing={listing}
        loadingLabel={t("marketplace.loading.agents")}
        count={available().length}
        empty={
          <Text as="p" variant="body" tone="muted">
            {t("marketplace.noMatch.agents")}
          </Text>
        }
      >
        <Show when={featured().length > 0}>
          <FeatureShelf scope={props.scope} agents={featured()} />
        </Show>
        <Show when={rest().length > 0}>
          <section class="marketplace-skill-group-list" aria-label={label()}>
            <Show when={featured().length > 0}>
              <h4 class="marketplace-app-group-title">{t("marketplace.agents.all")}</h4>
            </Show>
            <AgentRows scope={props.scope} agents={rest()} />
          </section>
        </Show>
      </ListingPanel>
    </div>
  );
}
