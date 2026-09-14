import { isBoolean, isOneOf } from "@openbot/contracts/runtime-values";
import { OpenPanel, OpenPanelBase, type OpenPanelOptions, type TrackProperties } from "@openpanel/web";
import { CONTENT_COLLECTIONS } from "./content";
import { type CollectionId, type ContentCollection, findArticle } from "./content-collection";
import { OPENBOT_DOWNLOAD_LINKS, OPENBOT_LINKS } from "./landing-links";

export const OPENPANEL_API_URL = "https://analytics.openbot.run/api";
const OPENPANEL_CLIENT_ID = "6c989975-87ef-4f0c-857e-ab449a65b5c2";
const ANALYTICS_SCHEMA_VERSION = 8;

export type LandingAcquisitionSource = "direct" | "search" | "social" | "github" | "other";

/** How far into an article the reader got. Reported once per depth per article view. */
export type ArticleReadDepth = "start" | "half" | "end";

/** An article the registries actually publish. Both fields are closed sets, never free text. */
export interface ArticleReference {
  collection: CollectionId;
  slug: string;
}

interface LandingAnalyticsEvents {
  landing_viewed: Record<string, never>;
  landing_download_clicked: { platform: LandingDownloadPlatform; placement: LandingPlacement };
  landing_link_clicked: { destination: LandingDestination; placement: LandingPlacement };
  landing_download_selected: { platform: LandingDownloadPlatform; detected: boolean };
  content_article_opened: ArticleReference & { placement: LandingPlacement };
  content_article_read: ArticleReference & { depth: ArticleReadDepth };
  join_page_action:
    | { action: "view"; valid_invite: boolean }
    | { action: "open_app" }
    | { action: "download"; platform: "macos" | "windows" };
}

type LandingEventName = keyof LandingAnalyticsEvents;
type LandingPlacement =
  | "header"
  | "hero"
  | "download_section"
  | "footer"
  | "content_index"
  | "content_article"
  | "content_related"
  | "other";

const LANDING_PLACEMENTS = [
  "header",
  "hero",
  "download_section",
  "footer",
  "content_index",
  "content_article",
  "content_related",
  "other",
] as const satisfies readonly LandingPlacement[];
/** The platforms the landing page can send a visitor to a download for. */
type LandingDownloadPlatform = "linux" | "macos" | "windows";
type LandingDestination =
  | "download_section"
  | "news"
  | "guides"
  | "contact"
  | "repository"
  | "releases"
  | "license"
  | "privacy"
  | "documentation"
  | "troubleshooting"
  | "architecture"
  | "contributing"
  | "codex"
  | "claude";

type CollectionIndexRoute = ContentCollection["indexRoute"];
/**
 * The screens a report may name. Article paths carry the slug so one article can be told from
 * another, and `safeScreenPath` keeps the set closed at runtime as well as in the type.
 */
export type LandingScreenPath = "/" | "/join" | CollectionIndexRoute | `${CollectionIndexRoute}/${string}`;

const FIXED_SCREEN_PATHS = ["/", "/join", "/news", "/guides"] as const satisfies readonly LandingScreenPath[];

/**
 * Any path that is not a fixed screen or a published article reports the landing page instead. A
 * caller cannot widen what reaches analytics by passing a different string.
 */
export function safeScreenPath(path: string): LandingScreenPath {
  if (isOneOf(FIXED_SCREEN_PATHS, path)) return path;
  const article = articleFromPath(path);
  if (!article) return "/";
  return `/${article.collection}/${article.slug}`;
}

/**
 * Resolves a site path to the article it names, or null. The slug is looked up in the registry, so
 * a link to an article that does not exist reports nothing rather than a new string.
 */
export function articleFromPath(path: string): ArticleReference | null {
  const [pathname = ""] = path.split(/[?#]/u);
  for (const collection of CONTENT_COLLECTIONS) {
    const prefix = `${collection.indexRoute}/`;
    if (!pathname.startsWith(prefix)) continue;
    const slug = pathname.slice(prefix.length);
    if (findArticle(collection, slug)) return { collection: collection.id, slug };
  }
  return null;
}

const PUBLISHED_SLUGS = new Set(
  CONTENT_COLLECTIONS.flatMap((collection) => collection.articles.map((article) => article.slug)),
);

type OpenPanelClient = Pick<OpenPanel, "setGlobalProperties"> & {
  track: (name: string, properties: TrackProperties, path: string) => ReturnType<OpenPanelBase["track"]>;
  trackScreenView: (path: string) => ReturnType<OpenPanelBase["track"]>;
};

type ClientFactory = (options: OpenPanelOptions) => OpenPanelClient;

/**
 * `OpenPanel.track` replaces `__path` with its own `lastPath`, which stays empty because screen
 * tracking is disabled here. The base method only merges the given properties, so both calls use it
 * and pass the reported path explicitly.
 */
function createOpenPanelClient(options: OpenPanelOptions): OpenPanelClient {
  const client = new OpenPanel(options);
  return {
    setGlobalProperties: (properties) => client.setGlobalProperties(properties),
    track: (name, properties, path) =>
      OpenPanelBase.prototype.track.call(client, name, { ...properties, __path: path }),
    trackScreenView: (path) => OpenPanelBase.prototype.track.call(client, "screen_view", { __path: path }),
  };
}

/** The download route each platform uses, reversed so a click can name the platform it asked for. */
const DOWNLOAD_PLATFORMS_BY_HREF = new Map<string, LandingDownloadPlatform>([
  [OPENBOT_DOWNLOAD_LINKS.macos, "macos"],
  [OPENBOT_DOWNLOAD_LINKS.windows, "windows"],
  [OPENBOT_DOWNLOAD_LINKS.linux, "linux"],
]);

const LINK_DESTINATIONS = new Map<string, LandingDestination>([
  [OPENBOT_LINKS.download, "download_section"],
  [OPENBOT_LINKS.downloadFromOtherPage, "download_section"],
  [OPENBOT_LINKS.news, "news"],
  [OPENBOT_LINKS.guides, "guides"],
  [OPENBOT_LINKS.contact, "contact"],
  [OPENBOT_LINKS.repository, "repository"],
  [OPENBOT_LINKS.releases, "releases"],
  [OPENBOT_LINKS.license, "license"],
  [OPENBOT_LINKS.privacy, "privacy"],
  [OPENBOT_LINKS.documentation, "documentation"],
  [OPENBOT_LINKS.troubleshooting, "troubleshooting"],
  [OPENBOT_LINKS.architecture, "architecture"],
  [OPENBOT_LINKS.contributing, "contributing"],
  [OPENBOT_LINKS.codex, "codex"],
  [OPENBOT_LINKS.claude, "claude"],
]);

const EVENT_PROPERTY_ALLOWLIST = {
  landing_viewed: [],
  landing_download_clicked: ["platform", "placement"],
  landing_download_selected: ["platform", "detected"],
  landing_link_clicked: ["destination", "placement"],
  content_article_opened: ["collection", "slug", "placement"],
  content_article_read: ["collection", "slug", "depth"],
  join_page_action: ["action", "valid_invite", "platform"],
} as const satisfies Record<LandingEventName, readonly string[]>;

/**
 * The hero selector runs its platform detection before the page component starts analytics, so an
 * event can arrive first. A small queue keeps that first event instead of dropping it. The wait is
 * for the current page to start, not merely for a client to exist: a visitor who opens an article
 * and then navigates home still has a client, and it holds the article's path and attribution.
 * Nothing flushes until no page has started, so the bound is what stops the queue growing.
 */
const PENDING_EVENT_LIMIT = 4;

export function shouldEnableLandingAnalytics(hostname: string, productionBuild: boolean): boolean {
  return productionBuild && hostname === "openbot.run";
}

export class LandingAnalytics {
  readonly #createClient: ClientFactory;
  readonly #productionBuild: boolean;
  #client: OpenPanelClient | null = null;
  #lastScreenPath: LandingScreenPath | null = null;
  #campaignPath = "/";
  #pageStarted = false;
  readonly #pending: { name: LandingEventName; properties: TrackProperties }[] = [];
  readonly #clickCleanup = new WeakMap<Document, (replacement: boolean) => void>();

  constructor(createClient: ClientFactory = createOpenPanelClient, productionBuild = import.meta.env.PROD) {
    this.#createClient = createClient;
    this.#productionBuild = productionBuild;
  }

  /**
   * `screenPath` separates the marketing surfaces that share this listener, down to the individual
   * article. It is passed as a string and narrowed by `safeScreenPath`, so a route that stops
   * matching the registry degrades to the landing page instead of reporting a new path.
   */
  start(document: Document, hostname: string, screenPath = "/"): () => void {
    if (isLikelyAutomation(document.defaultView?.navigator)) return () => undefined;
    if (!this.#ensureClient(hostname)) return () => undefined;
    const screen = safeScreenPath(screenPath);
    this.#campaignPath = landingCampaignPath(screen, document.location.href);
    this.#client?.setGlobalProperties({
      ...landingAttribution(document, hostname),
    });
    this.#pageStarted = true;
    this.#flushPending();
    this.#screenView(screen);
    this.#track("landing_viewed", {});
    const handleClick = (event: MouseEvent) => this.#handleClick(event);
    return this.#replaceClickListener(document, handleClick, screen);
  }

  /** The platform the hero offers: once for what was detected, then for each manual change. */
  trackDownloadSelected(platform: LandingDownloadPlatform, detected: boolean): void {
    this.#track("landing_download_selected", { platform, detected });
  }

  /** How far a reader got into an article. The caller reports each depth at most once. */
  trackArticleRead(article: ArticleReference, depth: ArticleReadDepth): void {
    this.#track("content_article_read", { ...article, depth });
  }

  startJoin(
    document: Document,
    hostname: string,
    options: { validInvite: boolean; platform: "macos" | "windows" },
  ): () => void {
    if (isLikelyAutomation(document.defaultView?.navigator)) return () => undefined;
    if (!this.#ensureClient(hostname)) return () => undefined;
    this.#campaignPath = landingCampaignPath("/join", document.location.href);
    this.#client?.setGlobalProperties({
      ...landingAttribution(document, hostname),
    });
    this.#pageStarted = true;
    this.#flushPending();
    this.#screenView("/join");
    this.#track("join_page_action", { action: "view", valid_invite: options.validInvite });
    const handleClick = (event: MouseEvent) => {
      const target = event.target;
      const link = target instanceof Element ? target.closest<HTMLAnchorElement>("a[href]") : null;
      if (link?.getAttribute("href")?.startsWith("openbot://")) {
        this.#track("join_page_action", { action: "open_app" });
        return;
      }
      const href = link?.getAttribute("href");
      if (href === OPENBOT_DOWNLOAD_LINKS.macos || href === OPENBOT_DOWNLOAD_LINKS.windows) {
        this.#track("join_page_action", {
          action: "download",
          platform: href === OPENBOT_DOWNLOAD_LINKS.windows ? "windows" : "macos",
        });
      }
    };
    return this.#replaceClickListener(document, handleClick, "/join");
  }

  #replaceClickListener(
    document: Document,
    listener: (event: MouseEvent) => void,
    screenPath: LandingScreenPath,
  ): () => void {
    this.#clickCleanup.get(document)?.(true);
    document.addEventListener("click", listener);
    let cleaned = false;
    const cleanup = (replacement: boolean) => {
      if (cleaned) return;
      cleaned = true;
      document.removeEventListener("click", listener);
      if (this.#clickCleanup.get(document) === cleanup) this.#clickCleanup.delete(document);
      if (replacement) return;
      // The page this listener belonged to is gone. Its path must not be reused by an event that
      // the next page's components send before that page calls `start`.
      this.#pageStarted = false;
      if (this.#lastScreenPath === screenPath) this.#lastScreenPath = null;
    };
    this.#clickCleanup.set(document, cleanup);
    return () => cleanup(false);
  }

  #ensureClient(hostname: string): boolean {
    if (!shouldEnableLandingAnalytics(hostname, this.#productionBuild)) return false;
    if (this.#client) return true;
    try {
      const client = this.#createClient({
        apiUrl: OPENPANEL_API_URL,
        clientId: OPENPANEL_CLIENT_ID,
        trackScreenViews: false,
        trackOutgoingLinks: false,
        trackAttributes: false,
        sessionReplay: { enabled: false },
      });
      client.setGlobalProperties({
        __referrer: "",
        surface: "landing",
        environment: "production",
        event_schema_version: ANALYTICS_SCHEMA_VERSION,
      });
      this.#client = client;
      return true;
    } catch {
      return false;
    }
  }

  #handleClick(event: MouseEvent): void {
    const target = event.target;
    const link = target instanceof Element ? target.closest<HTMLAnchorElement>("a[href]") : null;
    if (!link) return;
    const placement = landingPlacement(link);
    const href = link.getAttribute("href") ?? "";
    const downloadPlatform = DOWNLOAD_PLATFORMS_BY_HREF.get(href);
    if (downloadPlatform) {
      this.#track("landing_download_clicked", { platform: downloadPlatform, placement });
      return;
    }
    const destination = LINK_DESTINATIONS.get(href);
    if (destination) {
      this.#track("landing_link_clicked", { destination, placement });
      return;
    }
    // Article links carry the slug in the path, so they cannot be matched by an exact href. Without
    // this every card on an index page is dropped and the section looks like a dead end.
    const article = articleFromPath(href);
    if (article) this.#track("content_article_opened", { ...article, placement });
  }

  #screenView(path: LandingScreenPath): void {
    if (this.#lastScreenPath === path) return;
    try {
      const result = this.#client?.trackScreenView(this.#campaignPath);
      if (result instanceof Promise) void result.catch(() => undefined);
      this.#lastScreenPath = path;
    } catch {
      // Analytics must never change landing-page behavior.
    }
  }

  #track<Name extends LandingEventName>(name: Name, properties: LandingAnalyticsEvents[Name]): void {
    try {
      const allowed = EVENT_PROPERTY_ALLOWLIST[name];
      const sanitized = Object.fromEntries(
        Object.entries(properties).filter(
          ([key, value]) =>
            value !== undefined && allowed.some((item) => item === key) && isSafeLandingProperty(name, key, value),
        ),
      );
      this.#send(name, sanitized);
    } catch {
      // Analytics must never change landing-page behavior.
    }
  }

  #send(name: LandingEventName, properties: TrackProperties): void {
    if (!this.#client || !this.#pageStarted) {
      if (this.#pending.length < PENDING_EVENT_LIMIT) this.#pending.push({ name, properties });
      return;
    }
    const result = this.#client.track(name, properties, this.#campaignPath);
    if (result instanceof Promise) void result.catch(() => undefined);
  }

  #flushPending(): void {
    const queued = this.#pending.splice(0, this.#pending.length);
    for (const event of queued) this.#send(event.name, event.properties);
  }
}

function isSafeLandingProperty(name: LandingEventName, key: string, value: unknown): boolean {
  if (key === "action") return isOneOf(["view", "open_app", "download"] as const, value);
  if (key === "valid_invite") return name === "join_page_action" && isBoolean(value);
  if (key === "detected") return name === "landing_download_selected" && isBoolean(value);
  if (key === "collection") return isOneOf(["news", "guides"] as const, value);
  if (key === "slug") return typeof value === "string" && PUBLISHED_SLUGS.has(value);
  if (key === "depth") return isOneOf(["start", "half", "end"] as const, value);
  // The invitation page only ever offers the two platforms it can detect; the download events cover
  // every platform the site links to, Linux included.
  if (key === "platform") {
    if (name === "join_page_action") return value === "macos" || value === "windows";
    return isOneOf(["linux", "macos", "windows"] as const, value);
  }
  if (key === "placement") return isOneOf(LANDING_PLACEMENTS, value);
  if (key === "destination") return [...LINK_DESTINATIONS.values()].some((destination) => destination === value);
  return false;
}

export function isLikelyAutomation(navigator: Pick<Navigator, "userAgent" | "webdriver"> | null | undefined): boolean {
  if (!navigator) return false;
  return navigator.webdriver || /(?:bot|crawler|spider|headless|lighthouse|preview)/iu.test(navigator.userAgent);
}

const CAMPAIGN_PARAMETERS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;
/**
 * Campaign tags are marketer-authored labels. A value that is not a bounded lowercase label is
 * dropped instead of truncated, so no free text can escape through a campaign link.
 */
const SAFE_CAMPAIGN_VALUE = /^[a-z0-9][a-z0-9._-]{0,63}$/u;

/**
 * OpenPanel reads campaign attribution from the query of the reported path, so the allowlisted tags
 * must travel with the path. Every other parameter and the hash are dropped by construction.
 */
export function landingCampaignPath(screenPath: LandingScreenPath, href: string): string {
  let search: URLSearchParams;
  try {
    search = new URL(href).searchParams;
  } catch {
    return screenPath;
  }
  const campaign = new URLSearchParams();
  for (const key of CAMPAIGN_PARAMETERS) {
    const value = search.get(key)?.trim().toLowerCase() ?? "";
    if (SAFE_CAMPAIGN_VALUE.test(value)) campaign.set(key, value);
  }
  const query = campaign.toString();
  return query ? `${screenPath}?${query}` : screenPath;
}

// OpenPanel expects a URL. Keep only the domain, never credentials, ports or URL contents.
export function landingReferrer(referrer: string, hostname: string): string {
  try {
    const url = new URL(referrer);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    if (url.hostname === hostname || url.hostname.endsWith(`.${hostname}`)) return "";
    return `https://${url.hostname}/`;
  } catch {
    return "";
  }
}

// Regional search domains from https://www.google.com/supported_domains (2026-09-07).
const GOOGLE_DOMAINS = `google.com google.ad google.ae google.com.af google.com.ag google.al google.am google.co.ao
google.com.ar google.as google.at google.com.au google.az google.ba google.com.bd google.be
google.bf google.bg google.com.bh google.bi google.bj google.com.bn google.com.bo google.com.br
google.bs google.bt google.co.bw google.by google.com.bz google.ca google.cd google.cf google.cg
google.ch google.ci google.co.ck google.cl google.cm google.cn google.com.co google.co.cr
google.com.cu google.cv google.com.cy google.cz google.de google.dj google.dk google.dm
google.com.do google.dz google.com.ec google.ee google.com.eg google.es google.com.et google.fi
google.com.fj google.fm google.fr google.ga google.ge google.gg google.com.gh google.com.gi
google.gl google.gm google.gr google.com.gt google.gy google.com.hk google.hn google.hr google.ht
google.hu google.co.id google.ie google.co.il google.im google.co.in google.iq google.is google.it
google.je google.com.jm google.jo google.co.jp google.co.ke google.com.kh google.ki google.kg
google.co.kr google.com.kw google.kz google.la google.com.lb google.li google.lk google.co.ls
google.lt google.lu google.lv google.com.ly google.co.ma google.md google.me google.mg google.mk
google.ml google.com.mm google.mn google.com.mt google.mu google.mv google.mw google.com.mx
google.com.my google.co.mz google.com.na google.com.ng google.com.ni google.ne google.nl google.no
google.com.np google.nr google.nu google.co.nz google.com.om google.com.pa google.com.pe
google.com.pg google.com.ph google.com.pk google.pl google.pn google.com.pr google.ps google.pt
google.com.py google.com.qa google.ro google.ru google.rw google.com.sa google.com.sb google.sc
google.se google.com.sg google.sh google.si google.sk google.com.sl google.sn google.so google.sm
google.sr google.st google.com.sv google.td google.tg google.co.th google.com.tj google.tl google.tm
google.tn google.to google.com.tr google.tt google.com.tw google.co.tz google.com.ua google.co.ug
google.co.uk google.com.uy google.co.uz google.com.vc google.co.ve google.co.vi google.com.vn
google.vu google.ws google.rs google.co.za google.co.zm google.co.zw google.cat`.split(/\s+/u);

const SOURCE_PLATFORMS = [
  { platform: "instagram", category: "social", domains: ["instagram.com"], tags: ["instagram", "ig"] },
  { platform: "twitter", category: "social", domains: ["twitter.com", "x.com", "t.co"], tags: ["twitter", "x"] },
  { platform: "reddit", category: "social", domains: ["reddit.com", "redd.it"], tags: ["reddit"] },
  { platform: "facebook", category: "social", domains: ["facebook.com", "fb.com"], tags: ["facebook", "fb"] },
  { platform: "linkedin", category: "social", domains: ["linkedin.com", "lnkd.in"], tags: ["linkedin"] },
  { platform: "discord", category: "social", domains: ["discord.com", "discord.gg"], tags: ["discord"] },
  { platform: "tiktok", category: "social", domains: ["tiktok.com"], tags: ["tiktok"] },
  { platform: "youtube", category: "social", domains: ["youtube.com", "youtu.be"], tags: ["youtube"] },
  { platform: "github", category: "github", domains: ["github.com"], tags: ["github"] },
  { platform: "google", category: "search", domains: GOOGLE_DOMAINS, tags: ["google"] },
  { platform: "bing", category: "search", domains: ["bing.com"], tags: ["bing"] },
  { platform: "duckduckgo", category: "search", domains: ["duckduckgo.com"], tags: ["duckduckgo"] },
  { platform: "brave", category: "search", domains: ["search.brave.com"], tags: ["brave"] },
  { platform: "yahoo", category: "search", domains: ["yahoo.com", "yahoo.co.jp"], tags: ["yahoo"] },
] as const;

export function landingAttribution(document: Document, hostname: string) {
  const referrer = landingReferrer(document.referrer, hostname);
  let campaignSource = "";
  try {
    campaignSource = new URL(document.location.href).searchParams.get("utm_source")?.trim().toLowerCase() ?? "";
  } catch {
    // Missing campaign data leaves only the referring domain.
  }
  const tagged = SOURCE_PLATFORMS.find((source) => source.tags.some((tag) => campaignSource === tag));
  const domain = referrer ? new URL(referrer).hostname : "";
  const referred = SOURCE_PLATFORMS.find((source) =>
    source.domains.some((candidate) => domain === candidate || domain.endsWith(`.${candidate}`)),
  );
  const source = tagged ?? referred;
  const category: LandingAcquisitionSource = source?.category ?? (campaignSource || referrer ? "other" : "direct");
  return {
    acquisition_source: category,
    source_platform: source?.platform ?? "unknown",
    __referrer: referrer,
  };
}

function landingPlacement(link: HTMLAnchorElement): LandingPlacement {
  if (link.closest(".landing-header")) return "header";
  // Checked before `.post-article`, which wraps it: a card in the related row is a different
  // question from a link inside the article body.
  if (link.closest(".post-more")) return "content_related";
  if (link.closest(".landing-hero")) return "hero";
  if (link.closest(".landing-download")) return "download_section";
  if (link.closest(".landing-footer")) return "footer";
  // Without these, every link inside an article body reports "other", which makes
  // the article pages indistinguishable from each other in the report.
  if (link.closest(".post-index")) return "content_index";
  if (link.closest(".post-article")) return "content_article";
  return "other";
}

export const landingAnalytics = new LandingAnalytics();
