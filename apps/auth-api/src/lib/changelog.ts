import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { OPENBOT_SITE_URL, OPENBOT_X_HANDLE, type PageSocialImage, pageSocialImageMeta } from "./site-metadata";

export const CHANGELOG_ROUTE = "/changelog";
const CHANGELOG_TITLE = "OpenBot Changelog: Release Notes for Every Version";
export const CHANGELOG_DESCRIPTION =
  "Every OpenBot release, newest first: new features, improvements and fixes, with what to do after you upgrade.";
const CHANGELOG_SOCIAL_IMAGE: PageSocialImage = {
  path: "/social/changelog.jpg",
  alt: "Good things in the making. OpenBot agents around a paper sun",
};

export type ChangelogPlatform = "desktop" | "mobile";

export const CHANGELOG_PLATFORMS: readonly ChangelogPlatform[] = ["desktop", "mobile"];

export interface ChangelogSearch {
  platform?: "mobile" | undefined;
}

export function changelogSearch(value: unknown): ChangelogSearch {
  return { platform: isDynamicRecord(value) && value.platform === "mobile" ? "mobile" : undefined };
}

export type ChangelogGroupType = "added" | "changed" | "fixed" | "removed" | "security" | "deprecated" | "other";

export interface ChangelogGroup {
  type: ChangelogGroupType;
  heading: string;
  items: string[];
}

export type MobileStore = "ios" | "android";

export interface StoreAvailability {
  store: MobileStore;
  date: string;
  skipped: boolean;
}

export interface ChangelogRelease {
  version: string;
  date: string;
  stores: StoreAvailability[];
  anchor: string;
  intro: string[];
  notices: string[];
  groups: ChangelogGroup[];
}

export type InlineSegment =
  | { kind: "text" | "code" | "strong"; text: string }
  | { kind: "link"; text: string; href: string };

const RELEASE_HEADING = /^## \[([^\]]+)\](?:\s+-\s+(\d{4}-\d{2}-\d{2}))?/;
const IN_REVIEW_HEADING = /^## \[[^\]]+\]\s+-\s+In review\s*$/;
const SHARED_DATE_HEADING = /^## \[[^\]]+\]\s+-\s+\d{4}-\d{2}-\d{2}\s*$/;
const STORE_DATE = /(\d{4}-\d{2}-\d{2}) \((iOS|Android)\)/g;
const STORE_SKIPPED = /Skipped \((iOS|Android)\)/g;
const OTA_VERSION = /^\d+\.\d+\.\d+\.\d+$/;
const STORE_NAMES: Record<string, MobileStore> = { iOS: "ios", Android: "android" };
const MOBILE_STORES: readonly MobileStore[] = ["ios", "android"];
const GROUP_HEADING = /^### (.+)$/;
const BULLET = /^- (.*)$/;
const CONTINUATION = /^ {2,}(\S.*)$/;
const GROUP_TYPES: Partial<Record<string, ChangelogGroupType>> = {
  added: "added",
  changed: "changed",
  fixed: "fixed",
  removed: "removed",
  security: "security",
  deprecated: "deprecated",
};

const NOTICE = /\*\*[^*]+[.!]\*\*/;

function releaseAnchor(version: string): string {
  return `v${version.replace(/[^0-9a-z]+/gi, "-").toLowerCase()}`;
}

function isRealDate(date: string): boolean {
  return !Number.isNaN(Date.parse(`${date}T00:00:00Z`));
}

function storeAvailability(line: string, date: string): StoreAvailability[] {
  const dates = new Map<MobileStore, string>();
  if (SHARED_DATE_HEADING.test(line)) for (const store of MOBILE_STORES) dates.set(store, date);
  for (const [, day = "", name = ""] of line.matchAll(STORE_DATE)) {
    const store = STORE_NAMES[name];
    if (store && isRealDate(day)) dates.set(store, day);
  }
  const skipped = new Set<MobileStore>();
  for (const [, name = ""] of line.matchAll(STORE_SKIPPED)) {
    const store = STORE_NAMES[name];
    if (store && !dates.has(store)) skipped.add(store);
  }
  return MOBILE_STORES.map((store) => ({ store, date: dates.get(store) ?? "", skipped: skipped.has(store) })).sort(
    (a, b) => (a.date === "" ? 1 : 0) - (b.date === "" ? 1 : 0) || a.date.localeCompare(b.date),
  );
}

function groupType(heading: string): ChangelogGroupType {
  return GROUP_TYPES[heading.trim().toLowerCase()] ?? "other";
}

interface ParseChangelogOptions {
  anchorPrefix?: string;
  stores?: boolean;
}

export function parseChangelog(
  markdown: string,
  { anchorPrefix = "", stores = false }: ParseChangelogOptions = {},
): ChangelogRelease[] {
  const releases: ChangelogRelease[] = [];
  let release: ChangelogRelease | undefined;
  let group: ChangelogGroup | undefined;
  let open: string[] | undefined;

  const closeItem = () => {
    if (release && group && open === group.items) {
      const item = group.items.at(-1);
      if (item !== undefined && NOTICE.test(item)) {
        group.items.pop();
        release.notices.push(item);
      }
    }
    open = undefined;
  };

  for (const line of markdown.split(/\r?\n/)) {
    const heading = RELEASE_HEADING.exec(line);
    if (heading) {
      closeItem();
      const [, version = "", written = ""] = heading;
      const firstDate = isRealDate(written) ? written : "";
      const availability = (stores ? storeAvailability(line, firstDate) : []).filter(
        (entry) => entry.date !== "" || !OTA_VERSION.test(version),
      );
      group = undefined;
      const unavailable = stores && availability.every((entry) => entry.date === "");
      release =
        version.toLowerCase() === "unreleased" || IN_REVIEW_HEADING.test(line) || unavailable
          ? undefined
          : {
              version,
              date: availability[0]?.date || firstDate,
              stores: availability,
              anchor: `${anchorPrefix}${releaseAnchor(version)}`,
              intro: [],
              notices: [],
              groups: [],
            };
      if (release) releases.push(release);
      continue;
    }
    if (!release) continue;

    const groupHeading = GROUP_HEADING.exec(line);
    if (groupHeading) {
      closeItem();
      const name = groupHeading[1] ?? "";
      group = { type: groupType(name), heading: name.trim(), items: [] };
      release.groups.push(group);
      continue;
    }

    if (line.trim() === "") {
      closeItem();
      continue;
    }

    const bullet = BULLET.exec(line);
    if (bullet && group) {
      closeItem();
      group.items.push(bullet[1] ?? "");
      open = group.items;
      continue;
    }

    const continuation = CONTINUATION.exec(line);
    const text = (continuation?.[1] ?? line).trim();
    if (open && open.length > 0) {
      open[open.length - 1] = `${open.at(-1)} ${text}`;
      continue;
    }
    release.intro.push(text);
    open = release.intro;
  }
  closeItem();

  for (const entry of releases) entry.groups = entry.groups.filter((candidate) => candidate.items.length > 0);
  return releases;
}

const INLINE = /`([^`]+)`|\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;

export function parseInline(text: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0;
    if (index > last) segments.push({ kind: "text", text: text.slice(last, index) });
    const [whole, code, strong, label, href] = match;
    if (code !== undefined) segments.push({ kind: "code", text: code });
    else if (strong !== undefined) segments.push({ kind: "strong", text: strong });
    else if (label !== undefined && href !== undefined) segments.push({ kind: "link", text: label, href });
    last = index + whole.length;
  }
  if (last < text.length) segments.push({ kind: "text", text: text.slice(last) });
  return segments;
}

export function changelogUrl(siteUrl: string = OPENBOT_SITE_URL, platform: ChangelogPlatform = "desktop"): string {
  const url = new URL(CHANGELOG_ROUTE, siteUrl);
  if (platform === "mobile") url.searchParams.set("platform", platform);
  return url.toString();
}

export function changelogHead(siteUrl: string, platform: ChangelogPlatform = "desktop") {
  const url = changelogUrl(siteUrl, platform);
  const image = pageSocialImageMeta(CHANGELOG_SOCIAL_IMAGE, siteUrl);

  return {
    meta: [
      { title: CHANGELOG_TITLE },
      { name: "description", content: CHANGELOG_DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "OpenBot" },
      { property: "og:locale", content: "en_US" },
      { property: "og:url", content: url },
      { property: "og:title", content: CHANGELOG_TITLE },
      { property: "og:description", content: CHANGELOG_DESCRIPTION },
      ...image.openGraph,
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:site", content: OPENBOT_X_HANDLE },
      { name: "twitter:title", content: CHANGELOG_TITLE },
      { name: "twitter:description", content: CHANGELOG_DESCRIPTION },
      ...image.twitter,
    ],
    links: [{ rel: "canonical", href: url }],
  };
}
