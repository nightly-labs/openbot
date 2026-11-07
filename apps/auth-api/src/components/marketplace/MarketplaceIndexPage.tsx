import type { MarketplaceAgentSummary, MarketplaceSkillSummary } from "@openbot/contracts/ipc";
import { SKILL_CATEGORIES, type SkillCategory } from "@openbot/contracts/ipc-skills";
import type { MarketplaceListingLink } from "@openbot/contracts/marketplace-links";
import type { AppTextKey, AppTranslate, TranslatedLocale } from "@openbot/i18n";
import { CATEGORY_LABELS } from "@openbot/ui/features/marketplace/marketplace-listing";
import { Search } from "@openbot/ui/icons";
import { useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { Link } from "@tanstack/solid-router";
import { createMemo, createSignal, For, onSettled, Show, untrack } from "solid-js";
import { landingAnalytics } from "../../lib/analytics";
import {
  MARKETPLACE_APPS_ROUTE,
  MARKETPLACE_ROUTE,
  MARKETPLACE_SKILLS_ROUTE,
  MARKETPLACE_TAB_ROUTES,
  type MarketplaceTab,
  matchesMarketplaceQuery,
} from "../../lib/marketplace-routes";
import { matchesPluginTags, SITE_PLUGINS } from "../../lib/plugins";
import { PluginCard } from "../plugins/PluginCard";
import { PluginTagFilters } from "../plugins/PluginTagFilters";
import { AgentMark, ListingLink, MarketplaceFrame, SkillIcon, VerifiedMark } from "./MarketplaceParts";

/** One catalog item as the index shows it. */
interface Listing {
  link: MarketplaceListingLink;
  name: string;
  creatorName: string;
  description: string;
  verified: boolean;
  category: SkillCategory | null;
  featured: boolean;
  /** The avatar or the icon. It fills the box the row or the featured card gives it. */
  media: () => JSX.Element;
}

function agentListing(agent: MarketplaceAgentSummary): Listing {
  return {
    link: { kind: "agent", id: agent.id },
    name: agent.name,
    creatorName: agent.creatorName,
    description: agent.description,
    verified: agent.verified === true,
    category: agent.category ?? null,
    featured: agent.featured,
    media: () => <AgentMark agent={agent} />,
  };
}

function skillListing(skill: MarketplaceSkillSummary): Listing {
  return {
    link: { kind: "skill", id: skill.slug },
    name: skill.name,
    creatorName: skill.creatorName,
    description: skill.description,
    verified: skill.verified === true,
    category: skill.category,
    featured: skill.featured,
    media: () => <SkillIcon skill={skill} />,
  };
}

/** The rows a category shows when nothing is filtered; "See all" opens the category with every row. */
const ROWS_PER_GROUP = 4;
const FEATURED_LIMIT = 3;

/** The catalog's own picks, in catalog order. No count of installs decides what is featured. */
function featuredListings(listings: readonly Listing[]): Listing[] {
  return listings.filter((listing) => listing.featured).slice(0, FEATURED_LIMIT);
}

/** The categories that hold a listing: a link to an empty page is a dead end. */
function filledCategories(listings: readonly Listing[]): SkillCategory[] {
  return SKILL_CATEGORIES.filter((category) => listings.some((listing) => listing.category === category));
}

type CatalogTab = Exclude<MarketplaceTab, "apps">;
type CatalogRoute = (typeof MARKETPLACE_TAB_ROUTES)[CatalogTab];

/** The text that names the agents or the skills. Each key is written out, so the catalog check sees it. */
interface CatalogText {
  search: string;
  shown: (shown: number, total: number) => string;
  emptyCategory: string;
  emptyQuery: (query: string) => string;
}

function catalogText(t: AppTranslate, tab: CatalogTab): CatalogText {
  if (tab === "skills") {
    return {
      search: t("sitePage.marketplace.searchSkills"),
      shown: (shown, total) => t("sitePage.marketplace.shownSkills", { shown, total }),
      emptyCategory: t("sitePage.marketplace.emptySkillsCategory"),
      emptyQuery: (query) => t("sitePage.marketplace.emptySkillsQuery", { query }),
    };
  }
  return {
    search: t("sitePage.marketplace.searchAgents"),
    shown: (shown, total) => t("sitePage.marketplace.shownAgents", { shown, total }),
    emptyCategory: t("sitePage.marketplace.emptyAgentsCategory"),
    emptyQuery: (query) => t("sitePage.marketplace.emptyAgentsQuery", { query }),
  };
}

/** A featured listing: the avatar large, the name and the creator under it. */
function FeaturedCard(props: { listing: Listing }) {
  const { t } = useText();
  return (
    <li>
      <ListingLink link={props.listing.link} class="marketplace-site-feature">
        <span class="marketplace-site-feature-mark">{props.listing.media()}</span>
        <span class="marketplace-site-feature-name marketplace-site-name">
          {props.listing.name}
          <VerifiedMark verified={props.listing.verified} />
        </span>
        <span class="marketplace-site-feature-by">
          {t("sitePage.marketplace.by", { name: props.listing.creatorName })}
        </span>
      </ListingLink>
    </li>
  );
}

/**
 * One listing as a row: the avatar, "Name by Creator", one line, and Add. The whole row opens the
 * listing's page, because Add is there, after the line that says who checked the listing.
 */
function ListingRow(props: { listing: Listing }) {
  const { t } = useText();
  return (
    <li>
      <ListingLink link={props.listing.link} class="marketplace-site-row">
        <span class="marketplace-site-row-mark">{props.listing.media()}</span>
        <span class="marketplace-site-row-text">
          <span class="marketplace-site-row-title">
            <span class="marketplace-site-name">
              {props.listing.name}
              <VerifiedMark verified={props.listing.verified} />
            </span>{" "}
            <span class="marketplace-site-row-by">
              {t("sitePage.marketplace.by", { name: props.listing.creatorName })}
            </span>
          </span>
          <span class="marketplace-site-row-line">{props.listing.description}</span>
        </span>
        <span class="marketplace-site-row-add" aria-hidden="true">
          {t("sitePage.marketplace.add")}
        </span>
      </ListingLink>
    </li>
  );
}

/** A heading, "See all" when the group shows only part of its category, and the rows in two columns. */
function ListingGroup(props: {
  id: string;
  title: string;
  listings: readonly Listing[];
  route: CatalogRoute;
  seeAll?: SkillCategory | undefined;
}) {
  const { t } = useText();
  return (
    <section class="marketplace-site-group" aria-labelledby={props.id}>
      <div class="marketplace-site-group-head">
        <h2 class="marketplace-site-group-title" id={props.id}>
          {props.title}
        </h2>
        <Show when={props.seeAll}>
          {(category) => (
            <Link to={props.route} search={{ category: category() }} class="marketplace-site-view-all">
              {t("sitePage.marketplace.seeAll")}
              <span class="landing-visually-hidden"> {props.title}</span>
            </Link>
          )}
        </Show>
      </div>
      <ul class="marketplace-site-rows">
        <For each={props.listings}>{(listing) => <ListingRow listing={listing} />}</For>
      </ul>
    </section>
  );
}

/**
 * The agents or the skills. With no search and no category: Featured, the verified listings, then
 * each category. With a category: every listing in it. With a search: the listings that match.
 */
function Catalog(props: {
  tab: CatalogTab;
  listings: readonly Listing[];
  category: SkillCategory | undefined;
  query: string;
}) {
  const { t } = useText();
  const text = () => catalogText(t, props.tab);
  const route = () => MARKETPLACE_TAB_ROUTES[props.tab];
  const searching = () => props.query.trim() !== "";
  const browsing = () => !searching() && props.category === undefined;
  const matches = createMemo(() =>
    props.listings.filter(
      (listing) =>
        (props.category === undefined || listing.category === props.category) &&
        matchesMarketplaceQuery(props.query, listing.name, listing.creatorName, listing.description),
    ),
  );
  const featured = () => featuredListings(props.listings);
  const verified = () => props.listings.filter((listing) => listing.verified);
  const inCategory = (category: SkillCategory) => props.listings.filter((listing) => listing.category === category);
  const groupRows = (category: SkillCategory) => inCategory(category).slice(0, ROWS_PER_GROUP);
  const seeAll = (category: SkillCategory) => (inCategory(category).length > ROWS_PER_GROUP ? category : undefined);
  const filteredTitle = () => {
    if (searching() || props.category === undefined) return t("sitePage.marketplace.results");
    return t(CATEGORY_LABELS[props.category]);
  };
  const empty = () => (searching() ? text().emptyQuery(props.query.trim()) : text().emptyCategory);
  const emptyLine = () => <p class="plugin-empty marketplace-site-empty">{empty()}</p>;

  return (
    <>
      <p class="landing-visually-hidden" role="status">
        {text().shown(matches().length, props.listings.length)}
      </p>

      <Show when={browsing()}>
        <Show when={featured().length > 0}>
          <section class="marketplace-site-group" aria-labelledby="marketplace-featured-title">
            <div class="marketplace-site-group-head">
              <h2 class="marketplace-site-group-title" id="marketplace-featured-title">
                {t("sitePage.marketplace.featured")}
              </h2>
            </div>
            <ul class="marketplace-site-features">
              <For each={featured()}>{(listing) => <FeaturedCard listing={listing} />}</For>
            </ul>
          </section>
        </Show>
        <Show when={verified().length > 0}>
          <ListingGroup
            id="marketplace-verified-title"
            title={t("sitePage.marketplace.source.verified")}
            listings={verified()}
            route={route()}
          />
        </Show>
        <For each={filledCategories(props.listings)}>
          {(category) => (
            <ListingGroup
              id={`marketplace-${category}-title`}
              title={t(CATEGORY_LABELS[category])}
              listings={groupRows(category)}
              route={route()}
              seeAll={seeAll(category)}
            />
          )}
        </For>
      </Show>

      <Show when={!browsing()}>
        <Show when={matches().length > 0} fallback={emptyLine()}>
          <ListingGroup id="marketplace-filtered-title" title={filteredTitle()} listings={matches()} route={route()} />
        </Show>
      </Show>
    </>
  );
}

/**
 * "All" and each category that holds a listing. A category link keeps the search, so the address
 * names both and can be shared.
 */
function CategoryLinks(props: { route: CatalogRoute; listings: readonly Listing[]; query: string | undefined }) {
  const { t } = useText();
  const allSearch = () => ({ q: props.query });
  const categorySearch = (category: SkillCategory) => ({ q: props.query, category });
  return (
    <nav class="plugin-filters marketplace-site-categories" aria-label={t("sitePage.marketplace.categories")}>
      <Link to={props.route} search={allSearch()} activeOptions={{ exact: true }} class="plugin-tag-button">
        {t("sitePage.marketplace.allCategories")}
      </Link>
      <For each={filledCategories(props.listings)}>
        {(category) => (
          <Link
            to={props.route}
            search={categorySearch(category)}
            activeOptions={{ exact: true }}
            class="plugin-tag-button"
          >
            {t(CATEGORY_LABELS[category])}
          </Link>
        )}
      </For>
    </nav>
  );
}

/** One search field, as wide as the page, under the category links. */
function SearchField(props: { label: string; value: string; onInput: (value: string) => void }) {
  const { t } = useText();
  return (
    <div class="marketplace-site-search">
      <Search class="marketplace-site-search-icon" aria-hidden="true" />
      <input
        class="marketplace-site-search-input"
        type="search"
        aria-label={props.label}
        placeholder={t("marketplace.search.placeholder")}
        value={props.value}
        onInput={(event) => props.onInput(event.currentTarget.value)}
      />
    </div>
  );
}

/** The plugins that /plugins showed. The tag switches stay on the page; the search is in the address. */
function AppsList(props: { query: string; search: () => JSX.Element }) {
  const { t } = useText();
  const [selected, setSelected] = createSignal<readonly string[]>([]);
  const shown = createMemo(() =>
    SITE_PLUGINS.filter(
      (plugin) =>
        matchesPluginTags(plugin, selected()) &&
        matchesMarketplaceQuery(props.query, plugin.name, plugin.creatorName, plugin.tagline),
    ),
  );
  const toggle = (label: string) =>
    setSelected((tags) => (tags.includes(label) ? tags.filter((tag) => tag !== label) : [...tags, label]));
  return (
    <>
      <PluginTagFilters selected={selected} onToggle={toggle} onClear={() => setSelected([])} />
      {props.search()}
      <p class="landing-visually-hidden" role="status">
        {t("sitePage.marketplace.shownApps", { shown: shown().length, total: SITE_PLUGINS.length })}
      </p>
      <div class="plugin-grid">
        <For each={shown()}>{(plugin, index) => <PluginCard plugin={plugin} index={index()} />}</For>
      </div>
      <Show when={shown().length === 0}>
        <p class="plugin-empty marketplace-site-empty">{t("sitePage.marketplace.emptyApps")}</p>
      </Show>
    </>
  );
}

const TAB_LABELS = {
  agents: "marketplace.tab.agents",
  skills: "marketplace.tab.skills",
  apps: "marketplace.tab.apps",
} as const satisfies Record<MarketplaceTab, AppTextKey>;

/** A tab link is current on its own path, whatever the search and category are. */
const TAB_ACTIVE = { exact: true, includeSearch: false } as const;

function MarketplaceIndexContent(props: MarketplaceIndexPageProps) {
  const { t } = useText();
  // The field shows what the visitor types at once; the address follows it (see `onQuery`).
  const [query, setQuery] = createSignal(untrack(() => props.query ?? ""));
  const addressQuery = () => (query().trim() === "" ? undefined : query());
  const type = (value: string) => {
    setQuery(value);
    props.onQuery(value);
  };
  const isApps = () => props.tab === "apps";
  const catalogTab = (): CatalogTab => (props.tab === "skills" ? "skills" : "agents");
  const listings = createMemo(() =>
    props.tab === "skills" ? props.skills.map(skillListing) : props.agents.map(agentListing),
  );
  const searchLabel = () => {
    if (isApps()) return t("sitePage.marketplace.searchApps");
    return catalogText(t, catalogTab()).search;
  };
  // Named functions, not expressions in the props below: on the server-rendered site a conditional
  // in a component prop moves the hydration keys.
  const search = () => <SearchField label={searchLabel()} value={query()} onInput={type} />;
  const catalogRoute = () => MARKETPLACE_TAB_ROUTES[catalogTab()];

  onSettled(() => landingAnalytics.start(document, window.location.hostname, MARKETPLACE_TAB_ROUTES[props.tab]));

  return (
    <div class="post-container">
      <div class="plugin-intro marketplace-site-intro">
        <h1 class="plugin-intro-title">{t("marketplace.title")}</h1>
        <nav class="marketplace-site-switch" aria-label={t("marketplace.title")}>
          <Link to={MARKETPLACE_ROUTE} activeOptions={TAB_ACTIVE} class="marketplace-site-switch-option">
            {t("marketplace.tab.agents")}
          </Link>
          <Link to={MARKETPLACE_SKILLS_ROUTE} activeOptions={TAB_ACTIVE} class="marketplace-site-switch-option">
            {t("marketplace.tab.skills")}
          </Link>
          <Link to={MARKETPLACE_APPS_ROUTE} activeOptions={TAB_ACTIVE} class="marketplace-site-switch-option">
            {t("marketplace.tab.apps")}
          </Link>
        </nav>
      </div>

      <section class="marketplace-site-list" aria-label={t(TAB_LABELS[props.tab])}>
        <Show when={isApps()}>
          <AppsList query={query()} search={search} />
        </Show>
        <Show when={!isApps()}>
          <CategoryLinks route={catalogRoute()} listings={listings()} query={addressQuery()} />
          {search()}
          <Catalog tab={catalogTab()} listings={listings()} category={props.category} query={query()} />
        </Show>
      </section>
    </div>
  );
}

export interface MarketplaceIndexPageProps {
  tab: MarketplaceTab;
  lang: string;
  locale: TranslatedLocale;
  /** Every approved agent; empty on the other tabs. */
  agents: readonly MarketplaceAgentSummary[];
  /** Every approved skill; empty on the other tabs. */
  skills: readonly MarketplaceSkillSummary[];
  /** `?q=` when the page opened. */
  query: string | undefined;
  /** `?category=`. The Apps tab has none. */
  category: SkillCategory | undefined;
  /** The search changed. The route puts it in the address, so a filtered list is a link. */
  onQuery: (query: string) => void;
}

/** `/marketplace`, `/marketplace/skills` and `/marketplace/apps`. */
export function MarketplaceIndexPage(props: MarketplaceIndexPageProps) {
  return (
    <MarketplaceFrame lang={props.lang} locale={props.locale}>
      <MarketplaceIndexContent {...props} />
    </MarketplaceFrame>
  );
}
