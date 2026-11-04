import type {
  MarketplaceAgentDetail,
  MarketplaceAgentPage,
  MarketplaceAgentQuery,
  MarketplaceAgentSummary,
  MarketplaceSkillDetail,
  MarketplaceSkillPage,
  MarketplaceSkillQuery,
  MarketplaceSkillSummary,
} from "@openbot/contracts/ipc";
import { runTeamEffect } from "@openbot/team-client";
import { createMarketplaceCatalog, type MarketplaceCatalog } from "@openbot/team-client/marketplace-catalog";
import { fetch } from "@/features/support/model/logged-fetch";

const CATALOG_REQUEST_TIMEOUT_MS = 10_000;

/** The listings each Marketplace read asks for. The desktop overview asks for the same page size. */
export const MARKETPLACE_PAGE_SIZE = 50;
/** The most pages that one list reads, so a catalog that never ends cannot hold the phone. */
const MARKETPLACE_PAGE_LIMIT = 20;

/**
 * The public catalog of the account service at `apiUrl`. These reads need no account, so no
 * credential is sent, as for a shared agent template.
 */
function catalogFor(apiUrl: string): MarketplaceCatalog {
  return createMarketplaceCatalog(async (input, init) => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    init?.signal?.addEventListener("abort", abort, { once: true });
    if (init?.signal?.aborted) controller.abort();
    const timeout = setTimeout(abort, CATALOG_REQUEST_TIMEOUT_MS);
    try {
      // The catalog asks only for JSON; it sends no body and no credential.
      return await fetch(new URL(String(input), apiUrl).toString(), {
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
      init?.signal?.removeEventListener("abort", abort);
    }
  });
}

/**
 * An image address of the catalog. The account service can answer one relative to itself, because the
 * web client reads it on the same origin; the phone needs the whole address.
 */
export function catalogImageUrl(apiUrl: string, url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const resolved = new URL(url, apiUrl);
    // A development account service answers on plain http; its own images stay on its origin.
    return resolved.protocol === "https:" || resolved.origin === new URL(apiUrl).origin ? resolved.toString() : null;
  } catch {
    return null;
  }
}

/** The icon of a plugin's app, from the account service rather than the vendor's site. */
export function pluginIconUrl(apiUrl: string, slug: string, appId: string): string {
  const url = new URL(`/plugins/icon/${encodeURIComponent(slug)}`, apiUrl);
  url.searchParams.set("app", appId);
  return url.toString();
}

export function listMarketplaceAgents(
  apiUrl: string,
  query: MarketplaceAgentQuery,
  signal?: AbortSignal,
): Promise<MarketplaceAgentPage> {
  return runTeamEffect(catalogFor(apiUrl).agents.list(query), signal);
}

export function listMarketplaceSkills(
  apiUrl: string,
  query: MarketplaceSkillQuery,
  signal?: AbortSignal,
): Promise<MarketplaceSkillPage> {
  return runTeamEffect(catalogFor(apiUrl).skills.list(query), signal);
}

/**
 * Every page of a list, in order, as the desktop reads the next page with the cursor of the last one. Only
 * a failed first page fails the list: when a later page fails, the pages already read stay.
 */
async function allPages<Item>(
  read: (cursor: string | undefined) => Promise<{ items: Item[]; nextCursor: string | null | undefined }>,
  signal?: AbortSignal,
): Promise<Item[]> {
  const first = await read(undefined);
  const items = [...first.items];
  let cursor = first.nextCursor;
  for (let page = 1; cursor && page < MARKETPLACE_PAGE_LIMIT; page += 1) {
    try {
      const next = await read(cursor);
      items.push(...next.items);
      cursor = next.nextCursor;
    } catch (error) {
      if (signal?.aborted) throw error;
      break;
    }
  }
  return items;
}

/** Every agent listing that matches `query`, from all its pages. */
export function listAllMarketplaceAgents(
  apiUrl: string,
  query: MarketplaceAgentQuery,
  signal?: AbortSignal,
): Promise<MarketplaceAgentSummary[]> {
  return allPages(
    (cursor) =>
      listMarketplaceAgents(apiUrl, { ...query, cursor }, signal).then((page) => ({
        items: page.agents,
        nextCursor: page.nextCursor,
      })),
    signal,
  );
}

/** Every skill that matches `query`, from all its pages. */
export function listAllMarketplaceSkills(
  apiUrl: string,
  query: MarketplaceSkillQuery,
  signal?: AbortSignal,
): Promise<MarketplaceSkillSummary[]> {
  return allPages(
    (cursor) =>
      listMarketplaceSkills(apiUrl, { ...query, cursor }, signal).then((page) => ({
        items: page.skills,
        nextCursor: page.nextCursor,
      })),
    signal,
  );
}

export function loadMarketplaceAgent(
  apiUrl: string,
  listingId: string,
  signal?: AbortSignal,
): Promise<MarketplaceAgentDetail> {
  return runTeamEffect(catalogFor(apiUrl).agents.get(listingId), signal);
}

export function loadMarketplaceSkill(
  apiUrl: string,
  skillId: string,
  signal?: AbortSignal,
): Promise<MarketplaceSkillDetail> {
  return runTeamEffect(catalogFor(apiUrl).skills.get(skillId), signal);
}
