/**
 * The addresses one Marketplace agent or skill has: the page a person shares, the link that opens
 * that listing in the app, and the browser client's entry for it.
 *
 * ```
 * https://openbot.run/marketplace/agents/<id>     the link a person shares and the app copies
 * https://openbot.run/marketplace/skills/<slug>
 * openbot://marketplace/agents/<id>               the link the page button opens
 * openbot://marketplace/skills/<slug>
 * /app?marketplaceAgent=<id>                      the page's link to the browser client
 * /app?marketplaceSkill=<slug>
 * ```
 *
 * This follows `plugin-links.ts`: the host gives the kind, the path gives the argument, and a query
 * is refused, so the shape cannot grow an `?install=1`. A link opens the listing's page in the app;
 * adding the agent or skill is still a press of Add there.
 *
 * An agent has only its id, a UUID the Worker makes. A skill has a unique slug, made from its name.
 * Both forms are built from that value and never read from catalog data, so a listing cannot put a
 * foreign address behind the button that copies its own link.
 */

export const OPENBOT_MARKETPLACE_ORIGIN = "https://openbot.run";
export const OPENBOT_MARKETPLACE_PATH = "/marketplace";
export const OPENBOT_MARKETPLACE_HOST = "marketplace";
export const WEB_APP_MARKETPLACE_AGENT_PARAM = "marketplaceAgent";
export const WEB_APP_MARKETPLACE_SKILL_PARAM = "marketplaceSkill";

export type MarketplaceListingKind = "agent" | "skill";

export interface MarketplaceListingLink {
  kind: MarketplaceListingKind;
  /** The agent id, or the skill slug. */
  id: string;
}

const LISTING_SEGMENTS: Record<MarketplaceListingKind, string> = { agent: "agents", skill: "skills" };
const LISTING_KINDS: readonly MarketplaceListingKind[] = ["agent", "skill"];

/** `crypto.randomUUID()` in the Worker: lower-case hex in the 8-4-4-4-12 form. */
const MARKETPLACE_AGENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/**
 * The Worker's `slugify`: lower-case letters, digits and hyphens, at most 64. No dot and no slash, so
 * a slug cannot reach another path.
 */
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

/** The path of a listing page on the site, such as `/marketplace/agents/<id>`. */
export function marketplaceListingPath(link: MarketplaceListingLink): string {
  assertListing(link);
  return `${OPENBOT_MARKETPLACE_PATH}/${LISTING_SEGMENTS[link.kind]}/${link.id}`;
}

/**
 * Where a shared listing link points. The origin is `openbot.run`, or a loopback origin while a
 * developer runs the Account Worker on this computer; `agentTemplateShareOrigin` picks it.
 */
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

/** The link the page's button opens, which raises the app on this listing. */
export function createOpenBotMarketplaceUrl(link: MarketplaceListingLink): string {
  assertListing(link);
  return `openbot://${OPENBOT_MARKETPLACE_HOST}/${LISTING_SEGMENTS[link.kind]}/${link.id}`;
}

/**
 * The browser client's entry for a listing, on the same origin. `/app` removes the query after it
 * reads it, so a reload does not open the listing again.
 */
export function createWebAppMarketplacePath(link: MarketplaceListingLink): string {
  assertListing(link);
  const param = link.kind === "agent" ? WEB_APP_MARKETPLACE_AGENT_PARAM : WEB_APP_MARKETPLACE_SKILL_PARAM;
  return `/app?${param}=${link.id}`;
}

/** The listing in a `/app` query, or null when the query names none or an invalid one. */
export function marketplaceListingFromWebAppSearch(search: string): MarketplaceListingLink | null {
  const params = new URLSearchParams(search);
  const agent = params.get(WEB_APP_MARKETPLACE_AGENT_PARAM);
  if (agent !== null && isMarketplaceAgentId(agent)) return { kind: "agent", id: agent };
  const skill = params.get(WEB_APP_MARKETPLACE_SKILL_PARAM);
  if (skill !== null && isMarketplaceSkillSlug(skill)) return { kind: "skill", id: skill };
  return null;
}

/**
 * The listing a Marketplace link names, in either form. Throws for anything else.
 */
export function parseMarketplaceUrl(value: string): MarketplaceListingLink {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("The OpenBot Marketplace link is invalid.");
  }

  /* The origin is compared as one string. An `endsWith` or a host expression here is what lets
     `openbot.run.example.com` through. */
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

  /* Two segments, the kind and the id, and no empty one. `..` and a trailing slash fail here. */
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
