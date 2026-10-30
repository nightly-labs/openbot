import type {
  MarketplaceAgentDetail,
  MarketplaceAgentPage,
  MarketplaceAgentQuery,
  MarketplaceSkillDetail,
  MarketplaceSkillPage,
  MarketplaceSkillQuery,
} from "@openbot/contracts/ipc";
import { runTeamEffect } from "@openbot/team-client";
import { createMarketplaceCatalog, type MarketplaceCatalog } from "@openbot/team-client/marketplace-catalog";
import { fetch } from "@/features/support/model/logged-fetch";

const CATALOG_REQUEST_TIMEOUT_MS = 10_000;

/** The listings each Marketplace read asks for. The desktop overview asks for the same page size. */
export const MARKETPLACE_PAGE_SIZE = 50;

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
