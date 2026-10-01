import { type MarketplaceSkillQuery, SKILL_CATEGORIES, type SkillCategory } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { createEffect, createStore, onCleanup, untrack } from "solid-js";
import { currentText } from "../../text";

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

/** The rows the overview asks for each category, so a large catalog still shows every category. */
const HOME_ROWS_PER_CATEGORY = 6;
const HOME_PAGE_SIZE = 50;
const HOME_CACHE_MS = 5 * 60_000;
const PAGE_SIZE = 50;
const SEARCH_DELAY_MS = 220;

export interface CatalogItem {
  id: string;
  name: string;
  description: string;
  creatorName: string;
  creatorAvatarUrl?: string | null;
  category?: SkillCategory;
}

type CatalogPage<T> = { items: T[]; nextCursor: string | null };
export type CatalogList<T> = (query: MarketplaceSkillQuery) => Promise<CatalogPage<T>>;

function inCategory<T extends CatalogItem>(items: T[], category: SkillCategory): T[] {
  return items.filter((item) => (item.category ?? "other") === category);
}

/**
 * The overview in one request while the whole catalog fits in one page. A larger catalog can leave a
 * category short of rows, so only those categories then ask for their own first rows.
 */
async function loadHomePage<T extends CatalogItem>(list: CatalogList<T>): Promise<CatalogPage<T>> {
  const page = await list({ sort: "installs", limit: HOME_PAGE_SIZE });
  if (!page.nextCursor) return page;
  const short = SKILL_CATEGORIES.filter((category) => inCategory(page.items, category).length < HOME_ROWS_PER_CATEGORY);
  const pages = await Promise.all(
    short.map((category) => list({ category, sort: "installs", limit: HOME_ROWS_PER_CATEGORY })),
  );
  /* "Load more" goes on from the first page. A category row that page brings again is dropped as a duplicate. */
  return {
    items: [...page.items, ...pages.flatMap((categoryPage) => categoryPage.items)],
    nextCursor: page.nextCursor,
  };
}

/**
 * Each account Worker request costs money, and the Marketplace loads the overview again on each open.
 * The overview is one request, and this keeps its answer for a few minutes. The caller owns the
 * cache, so a different source never reads it.
 */
export class MarketplaceHomeCache<T extends CatalogItem> {
  #entry: { loadedAt: number; page: Promise<CatalogPage<T>> } | null = null;

  load(list: CatalogList<T>): Promise<CatalogPage<T>> {
    if (this.#entry && Date.now() - this.#entry.loadedAt < HOME_CACHE_MS) return this.#entry.page;
    const entry = { loadedAt: Date.now(), page: loadHomePage(list) };
    this.#entry = entry;
    entry.page.catch(() => {
      if (this.#entry === entry) this.#entry = null;
    });
    return entry.page;
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

export interface MarketplaceListing<T> {
  /** The rows to show: the answer to the current search, or the loaded rows narrowed until it arrives. */
  items: () => T[];
  loading: () => boolean;
  loadingMore: () => boolean;
  error: () => string | null;
  /** The server has not answered the current search yet, so an empty `items` is not "no match". */
  pending: () => boolean;
  /** The server holds rows past the loaded ones. */
  hasMore: () => boolean;
  loadMore: () => void;
  retry: () => void;
}

/**
 * One Marketplace listing: the overview, a category or a search, in pages. The search waits for a
 * pause in typing, and an answer to an older search or category never replaces a newer one.
 */
export function createMarketplaceListing<T extends CatalogItem>(options: {
  list: CatalogList<T>;
  /** Keeps the overview for a few minutes. Omit it for a list that is not a network call. */
  homeCache?: MarketplaceHomeCache<T> | undefined;
  query: () => string;
  category: () => SkillCategory | null;
}): MarketplaceListing<T> {
  const [state, setState] = createStore<{
    /** The trimmed query `items` came back for, so a newer keystroke knows it must filter them itself. */
    loadedQuery: string;
    items: T[];
    nextCursor: string | null;
    loading: boolean;
    loadingMore: boolean;
    error: string | null;
  }>({ loadedQuery: "", items: [], nextCursor: null, loading: true, loadingMore: false, error: null });
  let requestVersion = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function load(category: SkillCategory | null, query: string, cursor?: string) {
    const version = ++requestVersion;
    const trimmed = query.trim();
    /* A search keeps the rows it already has and filters them below, so typing never flashes a skeleton. */
    const keepVisible = !cursor && Boolean(trimmed) && state.items.length > 0;
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
      const home = !category && !trimmed && !cursor;
      const homePage = home
        ? await (options.homeCache ? options.homeCache.load(options.list) : loadHomePage(options.list))
        : null;
      const page = homePage
        ? null
        : await options.list({
            ...(category ? { category } : {}),
            ...(trimmed ? { query: trimmed } : {}),
            sort: "installs",
            limit: PAGE_SIZE,
            ...(cursor ? { cursor } : {}),
          });
      if (version !== requestVersion) return;
      setState((s) => {
        const allItems = (homePage ?? page)?.items ?? [];
        const items = allItems
          .filter((item, index) => allItems.findIndex((current) => current.id === item.id) === index)
          /*
           * An answer arrives as new objects, even for a row that is already on screen. Keeping the
           * object the row was built from lets the grid keep that row's element instead of building
           * it again, which is what made every keystroke blink the whole listing.
           */
          .map((item) => s.items.find((current) => same(current, item)) ?? item);
        s.items = cursor
          ? [...s.items, ...items.filter((item) => !s.items.some((current) => current.id === item.id))]
          : items;
        s.nextCursor = (homePage ?? page)?.nextCursor ?? null;
        s.loadedQuery = trimmed;
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

  /* A category change loads at once; typing waits for a pause before it reaches the network. */
  createEffect(
    () => [options.category(), options.query()] as const,
    ([category, query], previous) => {
      clearTimeout(timer);
      if (previous && previous[0] === category) {
        if (previous[1] === query) return;
        requestVersion++;
        /* Paging stops at the keystroke and starts again from the first page of the new query. */
        setState((s) => {
          s.nextCursor = null;
        });
        timer = setTimeout(() => void load(category, query), SEARCH_DELAY_MS);
        return;
      }
      void untrack(() => load(category, query));
    },
  );
  onCleanup(() => {
    requestVersion++;
    clearTimeout(timer);
  });

  /** True between a keystroke and the answer for it, when `items` still belongs to an older query. */
  const searchPending = () => {
    const query = options.query().trim();
    return Boolean(query) && state.loadedQuery !== query;
  };

  return {
    items: () => {
      if (!searchPending()) return state.items;
      const query = options.query().trim().toLowerCase();
      return state.items.filter(
        (item) =>
          item.name.toLowerCase().includes(query) ||
          item.creatorName.toLowerCase().includes(query) ||
          item.description.toLowerCase().includes(query),
      );
    },
    loading: () => state.loading,
    loadingMore: () => state.loadingMore,
    error: () => state.error,
    pending: () => state.loadedQuery !== options.query().trim(),
    hasMore: () => Boolean(state.nextCursor) && !searchPending(),
    loadMore: () => {
      const cursor = state.nextCursor;
      if (cursor && !state.loadingMore) void load(options.category(), options.query(), cursor);
    },
    retry: () => {
      clearTimeout(timer);
      /* A failed "Load more" keeps its rows and its cursor: ask for that page again. */
      const cursor = state.items.length > 0 ? (state.nextCursor ?? undefined) : undefined;
      void load(options.category(), options.query(), cursor);
    },
  };
}
