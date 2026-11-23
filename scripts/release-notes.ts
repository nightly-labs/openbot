import { execFileSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

const RELEASE_GROUPS = ["Added", "Changed", "Deprecated", "Removed", "Fixed", "Security"];
const PLACEHOLDER = /\b(TODO|TBD|FIXME|XXX)\b/;

export const UNRELEASED = "Unreleased";

export const IN_REVIEW = "In review";

export const MOBILE_STORES = ["ios", "android"] as const;
export type MobileStore = (typeof MOBILE_STORES)[number];
export const MOBILE_STORE_NAMES: Record<MobileStore, string> = { ios: "iOS", android: "Android" };

export const SKIPPED = "Skipped";

export type StoreState = string;

export type StoreDates = Partial<Record<MobileStore, StoreState>>;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const STORE_STATE = /^(\d{4}-\d{2}-\d{2}|Skipped) \(([^)]+)\)$/;
const isDay = (text: string) => DAY.test(text) && !Number.isNaN(Date.parse(`${text}T00:00:00Z`));
const storeNamed = (name: string) => MOBILE_STORES.find((store) => MOBILE_STORE_NAMES[store] === name);

export function storeDay(dates: StoreDates, store: MobileStore): string | undefined {
  const state = dates[store];
  return state === undefined || state === SKIPPED ? undefined : state;
}

export function parseStoreDates(text: string): StoreDates | undefined {
  if (text === IN_REVIEW) return {};
  if (isDay(text)) return { ios: text, android: text };
  const dates: StoreDates = {};
  const parts = text.split(", ");
  for (const part of parts) {
    const [, state = "", name = ""] = STORE_STATE.exec(part) ?? [];
    const store = storeNamed(name);
    if ((state !== SKIPPED && !isDay(state)) || store === undefined || dates[store] !== undefined) return undefined;
    dates[store] = state;
  }
  return parts.length <= 2 && formatStoreDates(dates) === text ? dates : undefined;
}

export function formatStoreDates(dates: StoreDates): string {
  const days = MOBILE_STORES.flatMap((store) => {
    const day = storeDay(dates, store);
    return day === undefined ? [] : [{ store, day }];
  }).sort((a, b) => a.day.localeCompare(b.day));
  const skipped = MOBILE_STORES.filter((store) => dates[store] === SKIPPED);
  const [first, second] = days;
  if (first === undefined && skipped.length === 0) return IN_REVIEW;
  if (first !== undefined && second !== undefined && second.day === first.day) return first.day;
  return [
    ...days.map(({ store, day }) => `${day} (${MOBILE_STORE_NAMES[store]})`),
    ...skipped.map((store) => `${SKIPPED} (${MOBILE_STORE_NAMES[store]})`),
  ].join(", ");
}

export function otaVersion(version: string): { store: string; number: number } | undefined {
  const [, store = "", number = ""] = /^(\d+\.\d+\.\d+)\.(\d+)$/.exec(version) ?? [];
  return store === "" ? undefined : { store, number: Number(number) };
}

export function otaSectionProblems(changelog: string): string[] {
  const headings = changelog.split(/\r?\n/).flatMap((line) => {
    const [, version = ""] = /^## \[([^\]]+)\]/.exec(line) ?? [];
    return version === "" ? [] : [{ version, line }];
  });
  const datesOf = (version: string) => {
    const prefix = `## [${version}] - `;
    const line = headings.find((heading) => heading.line.startsWith(prefix))?.line;
    return line === undefined ? undefined : parseStoreDates(line.slice(prefix.length));
  };
  return headings.flatMap(({ version, line }, index) => {
    const ota = otaVersion(version);
    if (ota === undefined) return [];
    const problems = releaseNotesProblems(changelog, version, { storeReview: true });
    const dates = datesOf(version) ?? {};
    const stores = MOBILE_STORES.filter((store) => dates[store] !== undefined);
    if (stores.length === 0 || stores.some((store) => dates[store] === SKIPPED)) {
      problems.push(
        `"${line}" is an OTA update, so it must have a date for each platform that gets it, and no "${IN_REVIEW}" or "${SKIPPED}".`,
      );
    }
    const below = ota.number > 1 ? `${ota.store}.${ota.number - 1}` : ota.store;
    if (ota.number < 1 || headings[index + 1]?.version !== below) {
      problems.push(`"${line}" must be directly above the "## [${below}]" section.`);
    }
    const storeDates = datesOf(ota.store) ?? {};
    for (const store of stores.filter((candidate) => storeDay(storeDates, candidate) === undefined)) {
      problems.push(
        `${version} names ${MOBILE_STORE_NAMES[store]}, but ${ota.store} is not available on ${MOBILE_STORE_NAMES[store]}.`,
      );
    }
    return problems;
  });
}

interface ReleaseNotesOptions {
  storeReview?: boolean;
}

export function releaseNotesProblems(
  changelog: string,
  version: string,
  { storeReview = false }: ReleaseNotesOptions = {},
): string[] {
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith(`## [${version}]`));
  if (start === -1) return [`CHANGELOG.md has no "## [${version}]" section.`];

  const problems: string[] = [];
  if (lines.filter((line) => line.startsWith(`## [${version}]`)).length > 1) {
    problems.push(`CHANGELOG.md has more than one "## [${version}]" section.`);
  }
  const heading = lines[start] ?? "";
  const date = /^## \[[^\]]+\] - (\d{4}-\d{2}-\d{2})$/.exec(heading)?.[1];
  const prefix = `## [${version}] - `;
  if (storeReview) {
    if (
      version !== UNRELEASED &&
      (!heading.startsWith(prefix) || parseStoreDates(heading.slice(prefix.length)) === undefined)
    ) {
      problems.push(
        `"${heading}" must be "${prefix}" and then "${IN_REVIEW}", a real YYYY-MM-DD date for both stores, ` +
          `"YYYY-MM-DD (Android)" or "YYYY-MM-DD (iOS)" for one store, or "YYYY-MM-DD (Android), YYYY-MM-DD (iOS)" ` +
          `with the earlier date first. A store that skipped the version is "${SKIPPED} (iOS)" or "${SKIPPED} (Android)", after the dates.`,
      );
    }
  } else if (version !== UNRELEASED && (date === undefined || !isDay(date))) {
    problems.push(`"${heading}" must be "## [${version}] - YYYY-MM-DD" with a real date.`);
  }

  const end = lines.findIndex((line, index) => index > start && line.startsWith("## "));
  const section = lines.slice(start + 1, end === -1 ? undefined : end);
  let group: string | undefined;
  let groupEntries = 0;
  let entries = 0;
  const closeGroup = () => {
    if (group !== undefined && groupEntries === 0) problems.push(`"### ${group}" in ${version} has no entries.`);
  };

  for (const line of section) {
    const groupHeading = /^### (.+)$/.exec(line);
    if (groupHeading) {
      closeGroup();
      group = (groupHeading[1] ?? "").trim();
      groupEntries = 0;
      if (!RELEASE_GROUPS.includes(group)) {
        problems.push(`"### ${group}" in ${version} is not one of ${RELEASE_GROUPS.join(", ")}.`);
      }
      continue;
    }
    if (line.startsWith("- ")) {
      if (group === undefined) problems.push(`"${line}" in ${version} is not under a "### " group.`);
      if (line.slice(2).trim() === "") problems.push(`An item in ${version} has no text.`);
      groupEntries += 1;
      entries += 1;
    }
    if (PLACEHOLDER.test(line)) problems.push(`"${line.trim()}" in ${version} is a placeholder.`);
  }
  closeGroup();

  if (entries === 0) {
    problems.push(`${version} has no entries. Add "- " items under "### Added", "### Changed" or "### Fixed".`);
  }
  return problems;
}

export const FRAGMENT_DIR = "changelog.d";

export const MOBILE_CHANGELOG = "apps/mobile/CHANGELOG.md";
export const MOBILE_FRAGMENT_DIR = "apps/mobile/changelog.d";
export const MOBILE_VERSION_FILES = ["apps/mobile/app.json", "apps/mobile/package.json"] as const;

export function unreleasedItems(changelog: string): string[] {
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith(`## [${UNRELEASED}]`));
  if (start === -1) return [];
  const end = lines.findIndex((line, index) => index > start && line.startsWith("## "));
  return lines.slice(start + 1, end === -1 ? undefined : end).filter((line) => line.startsWith("- "));
}

export async function releaseFragments(directory: string): Promise<string[]> {
  const names = (await readdir(directory, { recursive: true })).filter(
    (name) => name.endsWith(".md") && name !== "README.md",
  );
  const added = (path: string) => {
    const time = execFileSync("git", ["log", "--diff-filter=A", "--format=%ct", "-1", "--", path], {
      encoding: "utf8",
    }).trim();
    return time === "" ? Number.POSITIVE_INFINITY : Number(time);
  };
  return names
    .map((name) => join(directory, name))
    .map((path) => ({ path, time: added(path) }))
    .sort((a, b) => a.time - b.time || a.path.localeCompare(b.path))
    .map(({ path }) => path);
}

export function fragmentProblems(fragment: string): string[] {
  const problems = releaseNotesProblems(`## [${UNRELEASED}]\n${fragment}`, UNRELEASED);
  if (/^##? /m.test(fragment)) problems.push(`Use only "### " group headings in a fragment.`);
  for (const line of collectGroups(fragment, new Map())) problems.push(`"${line.trim()}" is not in a "- " item.`);
  return problems;
}

export function assembleSection(bodies: readonly string[]): string {
  const groups = new Map<string, string[]>();
  const stray = bodies.flatMap((body) => collectGroups(body, groups));
  if (stray.length > 0) {
    throw new Error(`These release notes lines are not in a "- " item:\n${stray.join("\n")}`);
  }
  const rank = (group: string) => {
    const index = RELEASE_GROUPS.indexOf(group);
    return index === -1 ? RELEASE_GROUPS.length : index;
  };
  return [...groups]
    .filter(([, items]) => items.length > 0)
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([group, items]) => `### ${group}\n\n${items.join("\n")}`)
    .join("\n\n");
}

function collectGroups(body: string, groups: Map<string, string[]>): string[] {
  const stray: string[] = [];
  let items: string[] | undefined;
  let open = false;
  for (const line of body.split(/\r?\n/)) {
    const groupHeading = /^### (.+)$/.exec(line);
    if (groupHeading) {
      const group = (groupHeading[1] ?? "").trim();
      items = groups.get(group) ?? [];
      groups.set(group, items);
      open = false;
    } else if (line.trim() === "") {
      open = false;
    } else if (items && line.startsWith("- ")) {
      items.push(line);
      open = true;
    } else if (items && open) {
      items[items.length - 1] += `\n${line}`;
    } else {
      stray.push(line);
    }
  }
  return stray;
}
