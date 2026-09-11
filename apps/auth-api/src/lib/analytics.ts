import { isBoolean, isOneOf } from "@openbot/contracts/runtime-values";
import { OpenPanel, OpenPanelBase, type OpenPanelOptions } from "@openpanel/web";
import { OPENBOT_DOWNLOAD_LINKS, OPENBOT_LINKS } from "./landing-links";

export const OPENPANEL_API_URL = "https://analytics.openbot.run/api";
const OPENPANEL_CLIENT_ID = "6c989975-87ef-4f0c-857e-ab449a65b5c2";
const ANALYTICS_SCHEMA_VERSION = 7;

export type LandingAcquisitionSource = "direct" | "search" | "social" | "github" | "other";

interface LandingAnalyticsEvents {
  landing_viewed: Record<string, never>;
  landing_download_clicked: { platform: "macos" | "windows"; placement: LandingPlacement };
  landing_link_clicked: { destination: LandingDestination; placement: LandingPlacement };
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
  | "other";

const LANDING_PLACEMENTS = [
  "header",
  "hero",
  "download_section",
  "footer",
  "content_index",
  "content_article",
  "other",
] as const satisfies readonly LandingPlacement[];
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

type LandingScreenPath = "/" | "/join" | "/news" | "/guides";

type OpenPanelClient = Pick<OpenPanel, "setGlobalProperties" | "track"> & {
  trackScreenView: (path: LandingScreenPath) => ReturnType<OpenPanelBase["track"]>;
};

type ClientFactory = (options: OpenPanelOptions) => OpenPanelClient;

function createOpenPanelClient(options: OpenPanelOptions): OpenPanelClient {
  const client = new OpenPanel(options);
  return {
    setGlobalProperties: (properties) => client.setGlobalProperties(properties),
    track: (name, properties) => client.track(name, properties),
    trackScreenView: (path) => OpenPanelBase.prototype.track.call(client, "screen_view", { __path: path }),
  };
}

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
  landing_link_clicked: ["destination", "placement"],
  join_page_action: ["action", "valid_invite", "platform"],
} as const satisfies Record<LandingEventName, readonly string[]>;

export function shouldEnableLandingAnalytics(hostname: string, productionBuild: boolean): boolean {
  return productionBuild && hostname === "openbot.run";
}

export class LandingAnalytics {
  readonly #createClient: ClientFactory;
  readonly #productionBuild: boolean;
  #client: OpenPanelClient | null = null;
  #lastScreenPath: LandingScreenPath | null = null;
  readonly #clickCleanup = new WeakMap<Document, (replacement: boolean) => void>();

  constructor(createClient: ClientFactory = createOpenPanelClient, productionBuild = import.meta.env.PROD) {
    this.#createClient = createClient;
    this.#productionBuild = productionBuild;
  }

  /**
   * `screenPath` separates the marketing surfaces that share this listener. The
   * click handling is the same on all of them; only the reported screen differs.
   */
  start(document: Document, hostname: string, screenPath: LandingScreenPath = "/"): () => void {
    if (isLikelyAutomation(document.defaultView?.navigator)) return () => undefined;
    if (!this.#ensureClient(hostname)) return () => undefined;
    this.#client?.setGlobalProperties({
      ...landingAttribution(document, hostname),
    });
    this.#screenView(screenPath);
    this.#track("landing_viewed", {});
    const handleClick = (event: MouseEvent) => this.#handleClick(event);
    return this.#replaceClickListener(document, handleClick, screenPath);
  }

  startJoin(
    document: Document,
    hostname: string,
    options: { validInvite: boolean; platform: "macos" | "windows" },
  ): () => void {
    if (isLikelyAutomation(document.defaultView?.navigator)) return () => undefined;
    if (!this.#ensureClient(hostname)) return () => undefined;
    this.#client?.setGlobalProperties({
      ...landingAttribution(document, hostname),
    });
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
      if (!replacement && this.#lastScreenPath === screenPath) this.#lastScreenPath = null;
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
    if (href === OPENBOT_DOWNLOAD_LINKS.macos) {
      this.#track("landing_download_clicked", { platform: "macos", placement });
      return;
    }
    if (href === OPENBOT_DOWNLOAD_LINKS.windows) {
      this.#track("landing_download_clicked", { platform: "windows", placement });
      return;
    }
    const destination = LINK_DESTINATIONS.get(href);
    if (destination) this.#track("landing_link_clicked", { destination, placement });
  }

  #screenView(path: LandingScreenPath): void {
    if (this.#lastScreenPath === path) return;
    try {
      const result = this.#client?.trackScreenView(path);
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
      const result = this.#client?.track(name, sanitized);
      if (result instanceof Promise) void result.catch(() => undefined);
    } catch {
      // Analytics must never change landing-page behavior.
    }
  }
}

function isSafeLandingProperty(name: LandingEventName, key: string, value: unknown): boolean {
  if (key === "action") return isOneOf(["view", "open_app", "download"] as const, value);
  if (key === "valid_invite") return name === "join_page_action" && isBoolean(value);
  if (key === "platform") return value === "macos" || value === "windows";
  if (key === "placement") return isOneOf(LANDING_PLACEMENTS, value);
  if (key === "destination") return [...LINK_DESTINATIONS.values()].some((destination) => destination === value);
  return false;
}

export function isLikelyAutomation(navigator: Pick<Navigator, "userAgent" | "webdriver"> | null | undefined): boolean {
  if (!navigator) return false;
  return navigator.webdriver || /(?:bot|crawler|spider|headless|lighthouse|preview)/iu.test(navigator.userAgent);
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
