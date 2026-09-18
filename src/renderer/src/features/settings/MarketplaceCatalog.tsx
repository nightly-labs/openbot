import { type MarketplaceSkillQuery, SKILL_CATEGORIES, type SkillCategory } from "@openbot/contracts/ipc";
import type { JSX } from "@solidjs/web";
import { createEffect, createStore, For, onCleanup, onSettled, Show } from "solid-js";
import { Button, Skeleton, UserAvatar } from "../../components/ui";
import { errorMessage } from "../../error-message";

export const CATEGORY_LABELS: Record<SkillCategory, string> = {
  coding: "Coding",
  design: "Design",
  "data-analytics": "Data & Analytics",
  documents: "Documents",
  productivity: "Productivity",
  research: "Research",
  automation: "Automation",
  other: "Other",
};

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
  kind: "skills" | "agents" | "plugins";
  /** The search text, held by the dialog chrome that shows the field next to the kind switch. */
  query: string;
  refreshVersion: number;
  list: (query: MarketplaceSkillQuery) => Promise<{ items: T[]; nextCursor: string | null }>;
  icon: (item: T) => JSX.Element;
  onOpen: (item: T) => void | Promise<void>;
}) {
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
      const pages = home
        ? await Promise.all(SKILL_CATEGORIES.map((category) => props.list({ category, sort: "installs", limit: 6 })))
        : [await props.list({ ...filters, limit: 50, ...(cursor ? { cursor } : {}) })];
      if (version !== requestVersion) return;
      setState((s) => {
        const allItems = pages.flatMap((page) => page.items);
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
        s.nextCursor = home ? null : (pages[0]?.nextCursor ?? null);
        if (home) s.moreCategories = SKILL_CATEGORIES.filter((_, index) => pages[index]?.nextCursor);
        s.loadedQuery = query.trim();
      });
    } catch (error) {
      if (version === requestVersion)
        setState((s) => {
          s.error = errorMessage(error, "Could not load the marketplace.");
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
                aria-label={`View ${item.name} details`}
                onClick={() => void props.onOpen(item)}
              />
              {props.icon(item)}
              <div class="skills-marketplace-card-copy">
                <div>
                  <h3>{item.name}</h3>
                  <span>by {item.creatorName}</span>
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
      aria-label={`Discover ${props.kind}`}
      data-search={state.query.trim() ? "" : undefined}
      data-pending={searchPending() ? "" : undefined}
    >
      <div class="marketplace-catalog-viewport" ref={viewport}>
        <div ref={listing}>
          <Show when={state.category} keyed>
            {(category) => (
              <div class="skills-marketplace-section-title">
                <h2>{CATEGORY_LABELS[category]}</h2>
                <Button variant="ghost" size="sm" onClick={() => selectCategory(null)}>
                  All {props.kind}
                </Button>
              </div>
            )}
          </Show>
          <Show when={state.error}>
            {(message) => (
              <div role="alert" class="skills-marketplace-state">
                {message()}
                <Button variant="ghost" onClick={() => void load()}>
                  Retry
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
            {/* The loaded rows hold only the first few of each category, so a query with no match among
            them waits for the answer rather than saying at once that nothing matches. */}
            <Show
              when={items().length || state.error || searchPending()}
              fallback={<div class="skills-marketplace-state">No {props.kind} match this search.</div>}
            >
              <Show
                when={overview()}
                fallback={
                  <section class="skills-marketplace-category-section">
                    <Show when={!state.category}>
                      <h2>Search results</h2>
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
                          <h2>{CATEGORY_LABELS[category]}</h2>
                          <Show when={state.moreCategories.includes(category)}>
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={`View all ${CATEGORY_LABELS[category]} ${props.kind}`}
                              onClick={() => selectCategory(category)}
                            >
                              View all
                            </Button>
                          </Show>
                        </div>
                        {rows(() => items().filter((item) => (item.category ?? "other") === category))}
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
                Load more
              </Button>
            </Show>
          </Show>
        </div>
      </div>
    </section>
  );
}
