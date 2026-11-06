// The release notes, read from the repository's own CHANGELOG.md and from apps/mobile/CHANGELOG.md
// for the iPhone app. The files are written for people already, in the Keep a Changelog shape, so
// the page reads them rather than asking a release to be written twice. No JSX and no Vite imports here, so the parser runs in a plain
// Node test; the file itself is imported in `changelog-releases.ts`, which only the page and
// the sitemap read.
//
// The parser covers the Markdown the file uses and nothing more: `## [x.y.z] - date` headings,
// the store dates of a mobile heading,
// `### Added` style groups, `-` bullets with indented continuation lines, plain paragraphs
// under a heading, and inline `**bold**`, `code` and [links](url).

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

/** The app a changelog covers. The web client ships with the desktop app, so it has no own list. */
export type ChangelogPlatform = "desktop" | "mobile";

/** In the order of the page's tabs, which is the direction a change of tab moves in. */
export const CHANGELOG_PLATFORMS: readonly ChangelogPlatform[] = ["desktop", "mobile"];

export interface ChangelogSearch {
  /** Absent for the desktop list, so `/changelog` stays the address of the page. */
  platform?: "mobile" | undefined;
}

/**
 * Always sets `platform`: the router lays the validated search over the raw one, so a key left
 * out keeps a value such as `?platform=tablet` that the page has no list for.
 */
export function changelogSearch(value: unknown): ChangelogSearch {
  return { platform: isDynamicRecord(value) && value.platform === "mobile" ? "mobile" : undefined };
}

export type ChangelogGroupType = "added" | "changed" | "fixed" | "removed" | "security" | "deprecated" | "other";

export interface ChangelogGroup {
  type: ChangelogGroupType;
  /** The heading as the file writes it, for a group this parser has no name for. */
  heading: string;
  items: string[];
}

/** A store of the mobile app. Each one reviews a build on its own. */
export type MobileStore = "ios" | "android";

export interface StoreAvailability {
  store: MobileStore;
  /** `YYYY-MM-DD`, the day the store made the version available. Empty while it reviews it. */
  date: string;
}

export interface ChangelogRelease {
  version: string;
  /** `YYYY-MM-DD`, the first day that the version was available. Empty when the heading has no real date. */
  date: string;
  /** Each store, with the version first available first. Empty for the desktop app, which has no store. */
  stores: StoreAvailability[];
  /** The fragment a link to this release uses, such as `v0-22-0`. */
  anchor: string;
  /** Paragraphs between the heading and the first group. */
  intro: string[];
  /** Bullets that ask the reader to act after upgrading. The file marks them in bold. */
  notices: string[];
  groups: ChangelogGroup[];
}

export type InlineSegment =
  | { kind: "text" | "code" | "strong"; text: string }
  | { kind: "link"; text: string; href: string };

const RELEASE_HEADING = /^## \[([^\]]+)\](?:\s+-\s+(\d{4}-\d{2}-\d{2}))?/;
/** A mobile version that no store has approved yet. `scripts/release-notes.ts` writes it. */
const IN_REVIEW_HEADING = /^## \[[^\]]+\]\s+-\s+In review\s*$/;
/** A heading with a date only is a mobile version that both stores have had since that day. */
const SHARED_DATE_HEADING = /^## \[[^\]]+\]\s+-\s+\d{4}-\d{2}-\d{2}\s*$/;
/** `2026-10-14 (Android)`: one store's date in a mobile heading, as `scripts/release-notes.ts` writes it. */
const STORE_DATE = /(\d{4}-\d{2}-\d{2}) \((iOS|Android)\)/g;
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

/** A bold run that ends a sentence is an instruction; a bold word such as a tab name is not. */
const NOTICE = /\*\*[^*]+[.!]\*\*/;

function releaseAnchor(version: string): string {
  return `v${version.replace(/[^0-9a-z]+/gi, "-").toLowerCase()}`;
}

function isRealDate(date: string): boolean {
  return !Number.isNaN(Date.parse(`${date}T00:00:00Z`));
}

/** The stores in a mobile heading. A store that the heading does not name still reviews the version. */
function storeAvailability(line: string, date: string): StoreAvailability[] {
  const dates = new Map<MobileStore, string>();
  if (SHARED_DATE_HEADING.test(line)) for (const store of MOBILE_STORES) dates.set(store, date);
  for (const [, day = "", name = ""] of line.matchAll(STORE_DATE)) {
    const store = STORE_NAMES[name];
    if (store && isRealDate(day)) dates.set(store, day);
  }
  return MOBILE_STORES.map((store) => ({ store, date: dates.get(store) ?? "" })).sort(
    (a, b) => (a.date === "" ? 1 : 0) - (b.date === "" ? 1 : 0) || a.date.localeCompare(b.date),
  );
}

function groupType(heading: string): ChangelogGroupType {
  return GROUP_TYPES[heading.trim().toLowerCase()] ?? "other";
}

interface ParseChangelogOptions {
  /** Keeps the anchors of two files apart when both have the same version. */
  anchorPrefix?: string;
  /** The file is the mobile app's, whose headings have a date for each store. */
  stores?: boolean;
}

/**
 * Every released version, newest first as the file lists them. Unreleased notes and a version
 * that no store has approved yet are left out.
 */
export function parseChangelog(
  markdown: string,
  { anchorPrefix = "", stores = false }: ParseChangelogOptions = {},
): ChangelogRelease[] {
  const releases: ChangelogRelease[] = [];
  let release: ChangelogRelease | undefined;
  let group: ChangelogGroup | undefined;
  // The list the last line was added to, so a continuation line knows where it belongs.
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
      // A date the page cannot format would stop the whole page from rendering.
      const firstDate = isRealDate(written) ? written : "";
      const availability = stores ? storeAvailability(line, firstDate) : [];
      group = undefined;
      release =
        version.toLowerCase() === "unreleased" || IN_REVIEW_HEADING.test(line)
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
    // A paragraph before the first group. A paragraph after one has no place to go in this
    // shape, so it stays with the intro rather than being dropped.
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
