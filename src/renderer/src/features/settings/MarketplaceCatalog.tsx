import { type MarketplaceSkillQuery, SKILL_CATEGORIES, type SkillCategory } from "@openbot/contracts/ipc";
import type { JSX } from "@solidjs/web";
import { createEffect, createStore, For, onCleanup, Show } from "solid-js";
import { Button, ChevronDown, DropdownMenu, Input, Search, Skeleton, UserAvatar } from "../../components/ui";
import { errorMessage } from "../../error-message";
import { useI18n } from "../i18n/i18n-context";

export const CATEGORY_LABELS: Record<SkillCategory, string> = {
  coding: "marketplace.categories.coding",
  design: "marketplace.categories.design",
  "data-analytics": "marketplace.categories.dataAnalytics",
  documents: "marketplace.categories.documents",
  productivity: "marketplace.categories.productivity",
  research: "marketplace.categories.research",
  automation: "marketplace.categories.automation",
  other: "marketplace.categories.other",
};

interface CatalogItem {
  id: string;
  name: string;
  description: string;
  creatorName: string;
  creatorAvatarUrl?: string | null;
  category?: SkillCategory;
}

export function MarketplaceIdentity(props: { item: CatalogItem; children: JSX.Element }) {
  return (
    <div class="marketplace-identity">
      {props.children}
      <UserAvatar
        class="marketplace-creator-avatar"
        decorative
        user={{ name: props.item.creatorName, email: "", avatarUrl: props.item.creatorAvatarUrl ?? null }}
      />
    </div>
  );
}

export function MarketplaceCatalog<T extends CatalogItem>(props: {
  kind: "skills" | "agents";
  refreshVersion: number;
  list: (query: MarketplaceSkillQuery) => Promise<{ items: T[]; nextCursor: string | null }>;
  icon: (item: T) => JSX.Element;
  onOpen: (item: T) => void | Promise<void>;
}) {
  const i18n = useI18n();
  const [state, setState] = createStore<{
    query: string;
    category: SkillCategory | null;
    items: T[];
    featured: T[];
    featuredLoaded: boolean;
    nextCursor: string | null;
    loading: boolean;
    loadingMore: boolean;
    error: string | null;
  }>({
    query: "",
    category: null,
    items: [],
    featured: [],
    featuredLoaded: false,
    nextCursor: null,
    loading: true,
    loadingMore: false,
    error: null,
  });
  let requestVersion = 0;
  let featuredRequest: Promise<{ items: T[]; nextCursor: string | null }> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const overview = () => !state.category && !state.query.trim();
  async function load(category = state.category, query = state.query, cursor?: string) {
    const version = ++requestVersion;
    setState((s) => {
      s.loading = !cursor;
      s.loadingMore = Boolean(cursor);
      s.error = null;
      if (!cursor) {
        s.items = [];
        s.nextCursor = null;
      }
    });
    try {
      const filters = {
        ...(category ? { category } : {}),
        ...(query.trim() ? { query: query.trim() } : {}),
        sort: "installs" as const,
      };
      const home = !category && !query.trim();
      if (!state.featuredLoaded && !featuredRequest) {
        featuredRequest = props.list({ featured: true, limit: 4 }).catch((error) => {
          featuredRequest = undefined;
          throw error;
        });
      }
      const [pages, featured] = await Promise.all([
        home
          ? Promise.all(SKILL_CATEGORIES.map((category) => props.list({ category, sort: "installs", limit: 6 })))
          : Promise.all([props.list({ ...filters, limit: 50, ...(cursor ? { cursor } : {}) })]),
        state.featuredLoaded ? null : featuredRequest,
      ]);
      if (version !== requestVersion) return;
      setState((s) => {
        const allItems = pages.flatMap((page) => page.items);
        const items = allItems.filter(
          (item, index) => allItems.findIndex((current) => current.id === item.id) === index,
        );
        s.items = cursor
          ? [...s.items, ...items.filter((item) => !s.items.some((current) => current.id === item.id))]
          : items;
        if (featured && !s.featuredLoaded) {
          s.featured = featured.items;
          s.featuredLoaded = true;
        }
        s.nextCursor = home ? null : (pages[0]?.nextCursor ?? null);
      });
    } catch (error) {
      if (version === requestVersion)
        setState((s) => {
          s.error = errorMessage(error, i18n.t("settingsMarketplace.loadError"));
        });
    } finally {
      if (version === requestVersion)
        setState((s) => {
          s.loading = false;
          s.loadingMore = false;
        });
    }
  }
  createEffect(
    () => props.refreshVersion,
    () => {
      if (state.featuredLoaded) {
        featuredRequest = undefined;
        setState((s) => {
          s.featuredLoaded = false;
        });
      }
      void load();
    },
  );
  onCleanup(() => {
    requestVersion++;
    clearTimeout(timer);
  });
  function selectCategory(category: SkillCategory | null) {
    clearTimeout(timer);
    setState((s) => {
      s.category = category;
    });
    void load(category);
  }
  function search(query: string) {
    clearTimeout(timer);
    requestVersion++;
    setState((s) => {
      s.query = query;
    });
    timer = setTimeout(() => void load(state.category, query), 500);
  }
  function rows(items: T[]) {
    return (
      <div class="skills-marketplace-grid">
        <For each={items}>
          {(item) => (
            <article class="skills-marketplace-card">
              <Button
                class="skills-marketplace-card-hitarea"
                variant="ghost"
                aria-label={`${i18n.t("settingsMarketplace.viewDetails")} ${item.name}`}
                onClick={() => void props.onOpen(item)}
              />
              {props.icon(item)}
              <div class="skills-marketplace-card-copy">
                <div>
                  <h3>{item.name}</h3>
                  <span>{`${i18n.t("settingsMarketplace.by")} ${item.creatorName}`}</span>
                </div>
                <p>{item.description}</p>
              </div>
            </article>
          )}
        </For>
      </div>
    );
  }
  return (
    <section class="marketplace-catalog" aria-label={`${i18n.t("settingsMarketplace.discover")} ${props.kind}`}>
      <Show when={state.loading && !state.featuredLoaded && state.featured.length === 0}>
        <div class="marketplace-featured marketplace-featured-placeholder" aria-hidden="true">
          <h2>{i18n.t("settingsMarketplace.featured")}</h2>
          <div class="marketplace-featured-grid">
            <For each={[0, 1, 2, 3]}>
              {() => (
                <div class="marketplace-featured-card">
                  <Skeleton class="marketplace-placeholder-avatar" />
                  <div class="marketplace-placeholder-copy">
                    <Skeleton />
                    <Skeleton />
                  </div>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>
      <Show when={state.featured.length > 0}>
        <section class="marketplace-featured" aria-label={i18n.t("settingsMarketplace.featured")}>
          <h2>{i18n.t("settingsMarketplace.featured")}</h2>
          <div class="marketplace-featured-grid">
            <For each={state.featured}>
              {(item) => (
                <Button
                  variant="ghost"
                  class="marketplace-featured-card"
                  aria-label={`${i18n.t("settingsMarketplace.viewFeatured")} ${item.name}`}
                  onClick={() => void props.onOpen(item)}
                >
                  <MarketplaceIdentity item={item}>{props.icon(item)}</MarketplaceIdentity>
                  <span>
                    <strong>{item.name}</strong>
                    <small>{item.creatorName}</small>
                  </span>
                </Button>
              )}
            </For>
          </div>
        </section>
      </Show>
      <div class="skills-marketplace-search">
        <Search aria-hidden="true" />
        <Input
          aria-label={`${i18n.t("settingsMarketplace.search")} ${props.kind}`}
          placeholder={`${i18n.t("settingsMarketplace.searchPlaceholder")} ${props.kind === "skills" ? "skill" : "agent"}`}
          value={state.query}
          onValueChange={search}
        />
      </div>
      <nav class="skills-marketplace-categories" aria-label={i18n.t("settingsMarketplace.categories")}>
        <Button
          size="sm"
          data-active={state.category === null ? "" : undefined}
          aria-pressed={state.category === null ? "true" : "false"}
          onClick={() => selectCategory(null)}
        >
          {i18n.t("settingsMarketplace.all")}
        </Button>
        <For each={SKILL_CATEGORIES.slice(0, 4)}>
          {(category) => (
            <Button
              size="sm"
              data-active={state.category === category ? "" : undefined}
              aria-pressed={state.category === category ? "true" : "false"}
              onClick={() => selectCategory(category)}
            >
              {i18n.t(CATEGORY_LABELS[category])}
            </Button>
          )}
        </For>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger class="marketplace-more" aria-label="More categories">
            {state.category && SKILL_CATEGORIES.indexOf(state.category) >= 4
              ? i18n.t(CATEGORY_LABELS[state.category])
              : i18n.t("settingsMarketplace.more")}
            <ChevronDown />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content class="marketplace-menu">
              <For each={SKILL_CATEGORIES.slice(4)}>
                {(category) => (
                  <DropdownMenu.Item onSelect={() => selectCategory(category)}>
                    {i18n.t(CATEGORY_LABELS[category])}
                  </DropdownMenu.Item>
                )}
              </For>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </nav>
      <Show when={state.error}>
        {(message) => (
          <div role="alert" class="skills-marketplace-state">
            {message()}
            <Button variant="ghost" onClick={() => void load()}>
              {i18n.t("settingsMarketplace.retry")}
            </Button>
          </div>
        )}
      </Show>
      <Show
        when={!state.loading}
        fallback={
          <div role="status" aria-label={`Loading ${props.kind}`} class="marketplace-catalog-skeleton">
            <For each={[0, 1, 2, 3, 4, 5]}>
              {() => (
                <div class="marketplace-row-skeleton" aria-hidden="true">
                  <Skeleton class="marketplace-placeholder-avatar" />
                  <div class="marketplace-placeholder-copy">
                    <Skeleton />
                    <Skeleton />
                  </div>
                </div>
              )}
            </For>
          </div>
        }
      >
        <Show
          when={state.items.length || state.error}
          fallback={
            <div class="skills-marketplace-state">{`${i18n.t("settingsMarketplace.noMatches")} ${props.kind}`}</div>
          }
        >
          <Show
            when={overview()}
            fallback={
              <section class="skills-marketplace-category-section">
                <h2>
                  {state.category
                    ? i18n.t(CATEGORY_LABELS[state.category])
                    : i18n.t("settingsMarketplace.searchResults")}
                </h2>
                {rows(state.items)}
              </section>
            }
          >
            <For each={SKILL_CATEGORIES}>
              {(category) => (
                <Show when={state.items.filter((item) => (item.category ?? "other") === category).length}>
                  <section class="skills-marketplace-category-section">
                    <div class="skills-marketplace-section-title">
                      <h2>{i18n.t(CATEGORY_LABELS[category])}</h2>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`${i18n.t("settingsMarketplace.viewAll")} ${i18n.t(CATEGORY_LABELS[category])} ${props.kind}`}
                        onClick={() => selectCategory(category)}
                      >
                        {i18n.t("settingsMarketplace.viewAllAction")}
                      </Button>
                    </div>
                    {rows(state.items.filter((item) => (item.category ?? "other") === category))}
                  </section>
                </Show>
              )}
            </For>
          </Show>
        </Show>
        <Show when={state.nextCursor}>
          <Button
            variant="ghost"
            loading={state.loadingMore}
            onClick={() => void load(state.category, state.query, state.nextCursor ?? undefined)}
          >
            {i18n.t("settingsMarketplace.loadMore")}
          </Button>
        </Show>
      </Show>
    </section>
  );
}
