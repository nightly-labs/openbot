import type { MarketplaceSkillQuery, SkillCategory } from "@openbot/contracts/ipc";
import { createRoot, createSignal, flush } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type CatalogItem,
  type CatalogList,
  createMarketplaceListing,
  MarketplaceHomeCache,
} from "./marketplace-listing";

type Row = CatalogItem & { category: SkillCategory };
type Page = { items: Row[]; nextCursor: string | null };

function row(id: string, overrides: Partial<Row> = {}): Row {
  return {
    id,
    name: id,
    description: "A skill for the release desk.",
    creatorName: "Ada",
    category: "documents",
    ...overrides,
  };
}

/** A listing in its own root, with the search and the category as signals the case can change. */
function listingOf(list: CatalogList<Row>, homeCache?: MarketplaceHomeCache<Row>) {
  const [query, setQuery] = createSignal("");
  const [category, setCategory] = createSignal<SkillCategory | null>(null);
  const { listing, dispose } = createRoot((stop) => ({
    listing: createMarketplaceListing({ list, homeCache, query, category }),
    dispose: stop,
  }));
  flush();
  return {
    listing,
    dispose,
    search: (value: string) => {
      setQuery(value);
      flush();
    },
    choose: (value: SkillCategory | null) => {
      setCategory(value);
      flush();
    },
  };
}

const ids = (items: readonly CatalogItem[]) => items.map((item) => item.id);

describe("createMarketplaceListing", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks only the categories the overview leaves short when the catalog is larger than one page", async () => {
    const documents = Array.from({ length: 6 }, (_, index) => row(`doc-${index}`));
    const list = vi.fn<CatalogList<Row>>(async (query) => {
      if (!query.category) return { items: documents, nextCursor: "next-page" };
      if (query.category === "design")
        return { items: [row("small-design", { category: "design" })], nextCursor: null };
      return { items: [], nextCursor: null };
    });
    const { listing, dispose } = listingOf(list);

    await vi.waitFor(() => expect(ids(listing.items())).toContain("small-design"));
    expect(list).not.toHaveBeenCalledWith(expect.objectContaining({ category: "documents" }));
    dispose();
  });

  it("keeps newer category results when an older request finishes last", async () => {
    const old = Promise.withResolvers<Page>();
    const list = vi.fn<CatalogList<Row>>(async (query) =>
      query.category === "design" ? old.promise : { items: [row("overview")], nextCursor: null },
    );
    const { listing, choose, dispose } = listingOf(list);
    choose("design");
    choose(null);
    await vi.waitFor(() => expect(ids(listing.items())).toEqual(["overview"]));

    old.resolve({ items: [row("stale", { category: "design" })], nextCursor: null });
    await old.promise;
    await Promise.resolve();
    expect(ids(listing.items())).toEqual(["overview"]);
    dispose();
  });

  it("collects the keystrokes of a word into one search request", async () => {
    vi.useFakeTimers();
    const list = vi.fn<CatalogList<Row>>(async () => ({ items: [], nextCursor: null }));
    const { search, dispose } = listingOf(list);
    await vi.advanceTimersByTimeAsync(0);
    list.mockClear();

    for (const value of ["s", "so", "sol", "sola", "solan", "solana"]) {
      search(value);
      await vi.advanceTimersByTimeAsync(20);
    }
    expect(list).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(220);
    expect(list).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ query: "solana" }));
    dispose();
  });

  it("loads the overview with one request and keeps it for the next open", async () => {
    const list = vi.fn<CatalogList<Row>>(async () => ({ items: [row("release-notes")], nextCursor: null }));
    const cache = new MarketplaceHomeCache<Row>();
    const first = listingOf(list, cache);
    await vi.waitFor(() => expect(ids(first.listing.items())).toEqual(["release-notes"]));
    first.dispose();

    const second = listingOf(list, cache);
    await vi.waitFor(() => expect(ids(second.listing.items())).toEqual(["release-notes"]));
    expect(list).toHaveBeenCalledTimes(1);
    second.dispose();
  });

  it("narrows the loaded rows while the search request is still open", async () => {
    const list = vi.fn<CatalogList<Row>>(async (query: MarketplaceSkillQuery) =>
      query.query
        ? new Promise<Page>(() => undefined)
        : {
            items: [row("release-notes", { name: "Release Notes" }), row("standup", { name: "Standup Digest" })],
            nextCursor: null,
          },
    );
    const { listing, search, dispose } = listingOf(list);
    await vi.waitFor(() => expect(ids(listing.items())).toHaveLength(2));

    search("standup");
    expect(ids(listing.items())).toEqual(["standup"]);
    dispose();
  });

  it("stops paging when the search changes until the first page of the new query arrives", async () => {
    const answer = Promise.withResolvers<Page>();
    const list = vi.fn<CatalogList<Row>>(async (query) =>
      query.query ? answer.promise : { items: [row("release-notes")], nextCursor: "next-page" },
    );
    const { listing, search, choose, dispose } = listingOf(list);
    choose("documents");
    await vi.waitFor(() => expect(listing.hasMore()).toBe(true));

    search("release");
    // The cursor belongs to the former query, so paging waits for the page of the new one.
    expect(listing.hasMore()).toBe(false);
    await vi.waitFor(() => expect(list).toHaveBeenCalledWith(expect.objectContaining({ query: "release" })));
    answer.resolve({ items: [row("release-notes")], nextCursor: "search-page" });
    await vi.waitFor(() => expect(listing.hasMore()).toBe(true));
    listing.loadMore();
    await vi.waitFor(() =>
      expect(list).toHaveBeenCalledWith(expect.objectContaining({ query: "release", cursor: "search-page" })),
    );
    dispose();
  });
});
