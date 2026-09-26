import { type MarketplaceSkillQuery, SKILL_CATEGORIES, type SkillCategory } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { Button, Skeleton, UserAvatar } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createEffect, createStore, For, onCleanup, onSettled, Show } from "solid-js";
import { currentText, useText } from "../../text";

export const CATEGORY_LABELS = {
  coding: "marketplace.category.coding",
  design: "marketplace.category.design",
  "data-analytics": "marketplace.category.dataAnalytics",
  documents: "marketplace.category.documents",
  productivity: "marketplace.category.productivity",
  research: "marketplace.category.research",
  automation: "marketplace.category.automation",
  other: "marketplace.category.other",
} as const satisfies Record<SkillCategory, AppTextKey>;

type CatalogKind = "skills" | "agents" | "plugins";

const DISCOVER_LABEL = {
  skills: "marketplace.discover.skills",
  agents: "marketplace.discover.agents",
  plugins: "marketplace.discover.plugins",
} as const satisfies Record<CatalogKind, AppTextKey>;

const ALL_LABEL = {
  skills: "marketplace.all.skills",
  agents: "marketplace.all.agents",
  plugins: "marketplace.all.plugins",
} as const satisfies Record<CatalogKind, AppTextKey>;

const LOADING_LABEL = {
  skills: "marketplace.loading.skills",
  agents: "marketplace.loading.agents",
  plugins: "marketplace.loading.plugins",
} as const satisfies Record<CatalogKind, AppTextKey>;

const NO_MATCH_LABEL = {
  skills: "marketplace.noMatch.skills",
  agents: "marketplace.noMatch.agents",
  plugins: "marketplace.noMatch.plugins",
} as const satisfies Record<CatalogKind, AppTextKey>;

const VIEW_ALL_LABEL = {
  skills: "marketplace.viewAllCategory.skills",
  agents: "marketplace.viewAllCategory.agents",
  plugins: "marketplace.viewAllCategory.plugins",
} as const;

/** The rows each category shows on the overview; a category with more offers its own page. */
const HOME_ROWS_PER_CATEGORY = 6;
const HOME_PAGE_SIZE = 50;
const HOME_CACHE_MS = 5 * 60_000;

type CatalogPage<T> = { items: T[]; nextCursor: string | null };
type CatalogList<T> = (query: MarketplaceSkillQuery) => Promise<CatalogPage<T>>;
/** The overview rows, and the categories that hold more than the overview shows. */
type HomePage<T> = { items: T[]; moreCategories: SkillCategory[] };

function inCategory<T extends CatalogItem>(items: T[], category: SkillCategory): T[] {
  return items.filter((item) => (item.category ?? "other") === category);
}

/**
 * The overview in one request while the whole catalog fits in one page. A larger catalog can leave a
 * category short of rows, so only those categories then ask for their own first rows, as each
 * category did before.
 */
async function loadHomePage<T extends CatalogItem>(list: CatalogList<T>): Promise<HomePage<T>> {
  const page = await list({ sort: "installs", limit: HOME_PAGE_SIZE });
  if (!page.nextCursor) {
    return {
      items: page.items,
      moreCategories: SKILL_CATEGORIES.filter(
        (category) => inCategory(page.items, category).length > HOME_ROWS_PER_CATEGORY,
      ),
    };
  }
  const short = SKILL_CATEGORIES.filter((category) => inCategory(page.items, category).length < HOME_ROWS_PER_CATEGORY);
  const pages = await Promise.all(
    short.map((category) => list({ category, sort: "installs", limit: HOME_ROWS_PER_CATEGORY })),
  );
  return {
    items: [...page.items, ...pages.flatMap((categoryPage) => categoryPage.items)],
    moreCategories: SKILL_CATEGORIES.filter((category) => {
      const index = short.indexOf(category);
      return index === -1 || Boolean(pages[index]?.nextCursor);
    }),
  };
}

/**
 * Each account Worker request costs money, and the dialog loads the overview again on each open and
 * tab switch. The overview is one request, and this keeps its answer for a few minutes. The caller
 * owns the cache, so Refresh can forget it and a different source never reads it.
 */
export class MarketplaceHomeCache<T extends CatalogItem> {
  #entry: { loadedAt: number; page: Promise<HomePage<T>> } | null = null;

  load(list: CatalogList<T>): Promise<HomePage<T>> {
    if (this.#entry && Date.now() - this.#entry.loadedAt < HOME_CACHE_MS) return this.#entry.page;
    const entry = { loadedAt: Date.now(), page: loadHomePage(list) };
    this.#entry = entry;
    entry.page.catch(() => {
      if (this.#entry === entry) this.#entry = null;
    });
    return entry.page;
  }

  /** Makes the next overview load ask again, for a user who asked to refresh. */
  forget(): void {
    this.#entry = null;
  }
}

/** Whether an answer's row is the row already on screen, so the list can keep the element it has. */
function same(a: CatalogItem, b: CatalogItem) {
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.description === b.description &&
    a.creatorName === b.creatorName &&
    a.creatorAvatarUrl === b.creatorAvatarUrl &&
    a.category === b.category
  );
}

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
  kind: CatalogKind;
  /** The search text, held by the dialog chrome that shows the field next to the kind switch. */
  query: string;
  refreshVersion: number;
  list: (query: MarketplaceSkillQuery) => Promise<{ items: T[]; nextCursor: string | null }>;
  /** Keeps the overview for a few minutes. Omit it for a list that is not a network call. */
  homeCache?: MarketplaceHomeCache<T>;
  icon: (item: T) => JSX.Element;
  onOpen: (item: T) => void | Promise<void>;
}) {
  const { t } = useText();
  const [state, setState] = createStore<{
    query: string;
    /** The trimmed query `items` came back for, so a newer keystroke knows it must filter them itself. */
    loadedQuery: string;
    category: SkillCategory | null;
    /** The overview categories that hold more than the rows on screen, so only those offer a way in. */
    moreCategories: SkillCategory[];
    items: T[];
    nextCursor: string | null;
    loading: boolean;
    loadingMore: boolean;
    error: string | null;
  }>({
    query: "",
    loadedQuery: "",
    category: null,
    moreCategories: [],
    items: [],
    nextCursor: null,
    loading: true,
    loadingMore: false,
    error: null,
  });
  let requestVersion = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const overview = () => !state.category && !state.query.trim();
  async function load(category = state.category, query = state.query, cursor?: string) {
    const version = ++requestVersion;
    /* A search keeps the rows it already has and filters them below, so typing never flashes a skeleton. */
    const keepVisible = !cursor && Boolean(query.trim()) && state.items.length > 0;
    setState((s) => {
      s.loading = !cursor && !keepVisible;
      s.loadingMore = Boolean(cursor);
      s.error = null;
      /*
       * A cursor belongs to the search that produced it. A first page therefore drops it, even when
       * the rows stay on screen: paging on with the old cursor would append a position from the
       * former query to the rows of the new one.
       */
      if (!cursor) {
        s.nextCursor = null;
        if (!keepVisible) s.items = [];
      }
    });
    try {
      const filters = {
        ...(category ? { category } : {}),
        ...(query.trim() ? { query: query.trim() } : {}),
        sort: "installs" as const,
      };
      const home = !category && !query.trim();
      const homeCache = props.homeCache;
      const homePage = home ? await (homeCache ? homeCache.load(props.list) : loadHomePage(props.list)) : null;
      const page = homePage ? null : await props.list({ ...filters, limit: 50, ...(cursor ? { cursor } : {}) });
      if (version !== requestVersion) return;
      setState((s) => {
        const allItems = homePage?.items ?? page?.items ?? [];
        const items = allItems
          .filter((item, index) => allItems.findIndex((current) => current.id === item.id) === index)
          /*
           * An answer arrives as new objects, even for a row that is already on screen. Keeping the
           * object the row was built from lets the list keep that row's element instead of building
           * it again, which is what made every keystroke blink the whole listing.
           */
          .map((item) => s.items.find((current) => same(current, item)) ?? item);
        s.items = cursor
          ? [...s.items, ...items.filter((item) => !s.items.some((current) => current.id === item.id))]
          : items;
        s.nextCursor = page?.nextCursor ?? null;
        if (homePage) s.moreCategories = homePage.moreCategories;
        s.loadedQuery = query.trim();
      });
    } catch (error) {
      if (version === requestVersion)
        setState((s) => {
          const text = currentText();
          s.error = text.errorMessage(error, text.t("marketplace.loadFailed"));
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
      void load();
    },
  );
  /* Typing waits before it reaches the network; the first run matches the empty state and loads nothing. */
  createEffect(
    () => props.query,
    (query) => {
      if (query === state.query) return;
      clearTimeout(timer);
      requestVersion++;
      setState((s) => {
        s.query = query;
        /* Paging stops at the keystroke and starts again from the first page of the new query. */
        s.nextCursor = null;
      });
      timer = setTimeout(() => void load(state.category, query), 220);
    },
  );
  onCleanup(() => {
    requestVersion++;
    clearTimeout(timer);
  });
  /** True between a keystroke and the answer for it, when `items` still belongs to an older query. */
  const searchPending = () => Boolean(state.query.trim()) && state.loadedQuery !== state.query.trim();
  /**
   * What the rows show: the answer to the current query once it arrives, and the loaded rows narrowed by
   * the query until then. Narrowing only ever removes rows, so the list never keeps a wrong match on
   * screen while the request runs.
   */
  const items = () => {
    const query = state.query.trim().toLowerCase();
    if (!searchPending()) return state.items;
    return state.items.filter(
      (item) =>
        item.name.toLowerCase().includes(query) ||
        item.creatorName.toLowerCase().includes(query) ||
        item.description.toLowerCase().includes(query),
    );
  };
  function selectCategory(category: SkillCategory | null) {
    clearTimeout(timer);
    setState((s) => {
      s.category = category;
    });
    void load(category);
  }
  /*
   * The rows take the list as a function, not as a value. Read as a value, the read would belong to
   * the JSX around the call, and every answer would build the grid again; inside `For` it belongs to
   * the list, which then keeps the rows it already has.
   */
  function rows(items: () => T[]) {
    return (
      <div class="skills-marketplace-grid">
        <For each={items()}>
          {(item) => (
            <article
              class="skills-marketplace-card"
              /* The hit area covers the card, so an avatar in it never sees the pointer itself. This marks
                 the card as the group whose hover starts the avatar's motion. */
              data-avatar-hover
            >
              <Button
                class="skills-marketplace-card-hitarea"
                variant="ghost"
                aria-label={t("marketplace.card.viewDetails", { name: item.name })}
                onClick={() => void props.onOpen(item)}
              />
              {props.icon(item)}
              <div class="skills-marketplace-card-copy">
                <div>
                  <h3>{item.name}</h3>
                  <span>{t("marketplace.card.byCreator", { creator: item.creatorName })}</span>
                </div>
                <p>{item.description}</p>
              </div>
            </article>
          )}
        </For>
      </div>
    );
  }
  let viewport: HTMLDivElement | undefined;
  let listing: HTMLDivElement | undefined;
  /*
   * Card resize (transitions.dev 01): a search adds and removes rows, and the listing's own height
   * follows the rows at once. Writing that height on the box around it lets the change travel between
   * the two sizes instead of snapping, which is what made typing feel like a jump. The first write is
   * the resting size, so it is made with the transition off.
   */
  onSettled(() => {
    const box = viewport;
    if (!box || !listing) return;
    let resting = true;
    const observer = new ResizeObserver((entries) => {
      const height = entries[0]?.contentRect.height;
      if (height === undefined) return;
      if (resting) {
        resting = false;
        box.style.transition = "none";
        box.style.height = `${height}px`;
        void box.offsetHeight;
        box.style.transition = "";
        return;
      }
      box.style.height = `${height}px`;
    });
    observer.observe(listing);
    return () => observer.disconnect();
  });
  return (
    <section
      class="marketplace-catalog"
      aria-label={t(DISCOVER_LABEL[props.kind])}
      data-search={state.query.trim() ? "" : undefined}
      data-pending={searchPending() ? "" : undefined}
    >
      <div class="marketplace-catalog-viewport" ref={viewport}>
        <div ref={listing}>
          <Show when={state.category} keyed>
            {(category) => (
              <div class="skills-marketplace-section-title">
                <h2>{t(CATEGORY_LABELS[category])}</h2>
                <Button variant="ghost" size="sm" onClick={() => selectCategory(null)}>
                  {t(ALL_LABEL[props.kind])}
                </Button>
              </div>
            )}
          </Show>
          <Show when={state.error}>
            {(message) => (
              <div role="alert" class="skills-marketplace-state">
                {message()}
                <Button variant="ghost" onClick={() => void load()}>
                  {t("common.retry")}
                </Button>
              </div>
            )}
          </Show>
          <Show
            when={!state.loading}
            fallback={
              <div role="status" aria-label={t(LOADING_LABEL[props.kind])} class="marketplace-catalog-skeleton">
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
            {/* The loaded rows hold only the first few of each category, so a query with no match among
            them waits for the answer rather than saying at once that nothing matches. */}
            <Show
              when={items().length || state.error || searchPending()}
              fallback={<div class="skills-marketplace-state">{t(NO_MATCH_LABEL[props.kind])}</div>}
            >
              <Show
                when={overview()}
                fallback={
                  <section class="skills-marketplace-category-section">
                    <Show when={!state.category}>
                      <h2>{t("marketplace.searchResults")}</h2>
                    </Show>
                    {rows(items)}
                  </section>
                }
              >
                <For each={SKILL_CATEGORIES}>
                  {(category) => (
                    <Show when={items().filter((item) => (item.category ?? "other") === category).length}>
                      <section class="skills-marketplace-category-section">
                        <div class="skills-marketplace-section-title">
                          <h2>{t(CATEGORY_LABELS[category])}</h2>
                          <Show when={state.moreCategories.includes(category)}>
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={t(VIEW_ALL_LABEL[props.kind], { category: t(CATEGORY_LABELS[category]) })}
                              onClick={() => selectCategory(category)}
                            >
                              {t("marketplace.viewAll")}
                            </Button>
                          </Show>
                        </div>
                        {rows(() =>
                          items()
                            .filter((item) => (item.category ?? "other") === category)
                            .slice(0, HOME_ROWS_PER_CATEGORY),
                        )}
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
                {t("marketplace.loadMore")}
              </Button>
            </Show>
          </Show>
        </div>
      </div>
    </section>
  );
}
