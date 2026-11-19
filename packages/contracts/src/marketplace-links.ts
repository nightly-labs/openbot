export const OPENBOT_MARKETPLACE_ORIGIN = "https://openbot.run";
export const OPENBOT_MARKETPLACE_PATH = "/marketplace";
export const OPENBOT_MARKETPLACE_HOST = "marketplace";
export const WEB_APP_MARKETPLACE_AGENT_PARAM = "marketplaceAgent";
export const WEB_APP_MARKETPLACE_SKILL_PARAM = "marketplaceSkill";

export type MarketplaceListingKind = "agent" | "skill";

export interface MarketplaceListingLink {
  kind: MarketplaceListingKind;
  id: string;
}

const LISTING_SEGMENTS: Record<MarketplaceListingKind, string> = { agent: "agents", skill: "skills" };
const LISTING_KINDS: readonly MarketplaceListingKind[] = ["agent", "skill"];

const MARKETPLACE_AGENT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,127}$/u;

const MARKETPLACE_SKILL_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/u;

export function isMarketplaceAgentId(value: string): boolean {
  return MARKETPLACE_AGENT_ID_PATTERN.test(value);
}

export function isMarketplaceSkillSlug(value: string): boolean {
  return MARKETPLACE_SKILL_SLUG_PATTERN.test(value);
}

function isListingId(kind: MarketplaceListingKind, id: string): boolean {
  return kind === "agent" ? isMarketplaceAgentId(id) : isMarketplaceSkillSlug(id);
}

function assertListing(link: MarketplaceListingLink): void {
  if (!isListingId(link.kind, link.id)) throw new Error("The OpenBot Marketplace link is invalid.");
}

export function marketplaceListingPath(link: MarketplaceListingLink): string {
  assertListing(link);
  return `${OPENBOT_MARKETPLACE_PATH}/${LISTING_SEGMENTS[link.kind]}/${link.id}`;
}

export function createMarketplaceShareUrl(
  link: MarketplaceListingLink,
  origin: string = OPENBOT_MARKETPLACE_ORIGIN,
): string {
  if (!isMarketplaceShareOrigin(origin)) throw new Error("The OpenBot Marketplace link origin is invalid.");
  return `${origin}${marketplaceListingPath(link)}`;
}

function isMarketplaceShareOrigin(origin: string): boolean {
  if (origin === OPENBOT_MARKETPLACE_ORIGIN) return true;
  try {
    const url = new URL(origin);
    return (
      url.protocol === "http:" &&
      (url.hostname === "127.0.0.1" || url.hostname === "localhost") &&
      url.origin === origin
    );
  } catch {
    return false;
  }
}

export function createOpenBotMarketplaceUrl(link: MarketplaceListingLink): string {
  assertListing(link);
  return `openbot://${OPENBOT_MARKETPLACE_HOST}/${LISTING_SEGMENTS[link.kind]}/${link.id}`;
}

export function createWebAppMarketplacePath(link: MarketplaceListingLink): string {
  assertListing(link);
  const param = link.kind === "agent" ? WEB_APP_MARKETPLACE_AGENT_PARAM : WEB_APP_MARKETPLACE_SKILL_PARAM;
  return `/app?${param}=${link.id}`;
}

export function marketplaceListingFromWebAppSearch(search: string): MarketplaceListingLink | null {
  const params = new URLSearchParams(search);
  const agent = params.get(WEB_APP_MARKETPLACE_AGENT_PARAM);
  if (agent !== null && isMarketplaceAgentId(agent)) return { kind: "agent", id: agent };
  const skill = params.get(WEB_APP_MARKETPLACE_SKILL_PARAM);
  if (skill !== null && isMarketplaceSkillSlug(skill)) return { kind: "skill", id: skill };
  return null;
}

export function parseMarketplaceUrl(value: string): MarketplaceListingLink {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("The OpenBot Marketplace link is invalid.");
  }

  const prefix = `${OPENBOT_MARKETPLACE_PATH}/`;
  const canonical =
    url.protocol === "https:" && url.origin === OPENBOT_MARKETPLACE_ORIGIN && url.pathname.startsWith(prefix);
  const customScheme = url.protocol === "openbot:" && url.hostname === OPENBOT_MARKETPLACE_HOST;
  if (
    (!canonical && !customScheme) ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("The OpenBot Marketplace link is invalid.");
  }

  const rest = canonical ? url.pathname.slice(prefix.length) : url.pathname.replace(/^\//u, "");
  const [segment, id, ...extra] = rest.split("/");
  const kind = LISTING_KINDS.find((candidate) => LISTING_SEGMENTS[candidate] === segment);
  if (kind === undefined || id === undefined || extra.length > 0) {
    throw new Error("The OpenBot Marketplace link is invalid.");
  }
  const link = { kind, id };
  assertListing(link);
  return link;
}
