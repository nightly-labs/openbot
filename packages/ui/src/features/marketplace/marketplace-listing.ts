import {
  type MarketplaceSkillQuery,
  type MarketplaceSkillSort,
  SKILL_CATEGORIES,
  type SkillCategory,
} from "@openbot/contracts/ipc";
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

async function loadHomePage<T extends CatalogItem>(
  list: CatalogList<T>,
  verified?: boolean | undefined,
): Promise<CatalogPage<T>> {
  const source = verified === undefined ? {} : { verified };
  const page = await list({ ...source, sort: "installs", limit: HOME_PAGE_SIZE });
  if (!page.nextCursor) return page;
  const short = SKILL_CATEGORIES.filter((category) => inCategory(page.items, category).length < HOME_ROWS_PER_CATEGORY);
  const pages = await Promise.all(
    short.map((category) => list({ ...source, category, sort: "installs", limit: HOME_ROWS_PER_CATEGORY })),
  );
  return {
    items: [...page.items, ...pages.flatMap((categoryPage) => categoryPage.items)],
    nextCursor: page.nextCursor,
  };
}

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
  items: () => T[];
  loading: () => boolean;
  loadingMore: () => boolean;
  error: () => string | null;
  pending: () => boolean;
  hasMore: () => boolean;
  loadMore: () => void;
  retry: () => void;
}

interface ListingFilter {
  category: SkillCategory | null;
  sort: MarketplaceSkillSort;
  verified: boolean | undefined;
}

function sameFilter(a: ListingFilter, b: ListingFilter) {
  return a.category === b.category && a.sort === b.sort && a.verified === b.verified;
}

export function createMarketplaceListing<T extends CatalogItem>(options: {
  list: CatalogList<T>;
  homeCache?: MarketplaceHomeCache<T> | undefined;
  query: () => string;
  category: () => SkillCategory | null;
  sort?: (() => MarketplaceSkillSort) | undefined;
  verified?: (() => boolean | undefined) | undefined;
}): MarketplaceListing<T> {
  const filter = (): ListingFilter => ({
    category: options.category(),
    sort: options.sort?.() ?? "installs",
    verified: options.verified?.(),
  });
  const [state, setState] = createStore<{
    loadedQuery: string;
    items: T[];
    nextCursor: string | null;
    loading: boolean;
    loadingMore: boolean;
    error: string | null;
  }>({ loadedQuery: "", items: [], nextCursor: null, loading: true, loadingMore: false, error: null });
  let requestVersion = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function load({ category, sort, verified }: ListingFilter, query: string, cursor?: string) {
    const version = ++requestVersion;
    const trimmed = query.trim();
    const keepVisible = !cursor && Boolean(trimmed) && state.items.length > 0;
    setState((s) => {
      s.loading = !cursor && !keepVisible;
      s.loadingMore = Boolean(cursor);
      s.error = null;
      if (!cursor) {
        s.nextCursor = null;
        if (!keepVisible) s.items = [];
      }
    });
    try {
      const home = !category && !trimmed && !cursor && sort === "installs";
      const cache = verified === undefined ? options.homeCache : undefined;
      const homePage = home ? await (cache ? cache.load(options.list) : loadHomePage(options.list, verified)) : null;
      const page = homePage
        ? null
        : await options.list({
            ...(category ? { category } : {}),
            ...(trimmed ? { query: trimmed } : {}),
            ...(verified === undefined ? {} : { verified }),
            sort,
            limit: PAGE_SIZE,
            ...(cursor ? { cursor } : {}),
          });
      if (version !== requestVersion) return;
      setState((s) => {
        const allItems = (homePage ?? page)?.items ?? [];
        const items = allItems
          .filter((item, index) => allItems.findIndex((current) => current.id === item.id) === index)
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

  createEffect(
    () => [filter(), options.query()] as const,
    ([current, query], previous) => {
      clearTimeout(timer);
      if (previous && sameFilter(previous[0], current)) {
        if (previous[1] === query) return;
        requestVersion++;
        setState((s) => {
          s.nextCursor = null;
        });
        timer = setTimeout(() => void load(current, query), SEARCH_DELAY_MS);
        return;
      }
      void untrack(() => load(current, query));
    },
  );
  onCleanup(() => {
    requestVersion++;
    clearTimeout(timer);
  });

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
      if (cursor && !state.loadingMore) void load(filter(), options.query(), cursor);
    },
    retry: () => {
      clearTimeout(timer);
      const cursor = state.items.length > 0 ? (state.nextCursor ?? undefined) : undefined;
      void load(filter(), options.query(), cursor);
    },
  };
}
