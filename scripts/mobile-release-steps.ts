import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { isNewerMobileVersion } from "../packages/contracts/src/mobile-features";
import { MOBILE_ANNOUNCEMENT_FILE, mobileAnnouncementProblems } from "./discord-mobile-release-announcement";
import {
  formatStoreDates,
  MOBILE_CHANGELOG,
  MOBILE_FRAGMENT_DIR,
  MOBILE_STORE_NAMES,
  MOBILE_VERSION_FILES,
  type MobileStore,
  otaVersion,
  parseStoreDates,
  releaseNotesProblems,
  SKIPPED,
  type StoreDates,
  type StoreState,
  storeDay,
} from "./release-notes";

export const MOBILE_FEATURES_CONFIG_FILE = "apps/auth-api/src/server/mobile-features-config.ts";

export interface FileChange {
  path: string;
  text: string;
  summary: string;
}

export function readText(path: string): string {
  return readFileSync(path, "utf8");
}

export function appJsonVersion(source: string, name: string = MOBILE_VERSION_FILES[0]): string {
  const appJson = JSON.parse(source);
  const version = isDynamicRecord(appJson) && isDynamicRecord(appJson.expo) ? appJson.expo.version : undefined;
  if (!isString(version)) throw new Error(`${name} has no valid version.`);
  return version;
}

export function appVersion(): string {
  return appJsonVersion(readText(MOBILE_VERSION_FILES[0]));
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const headingPrefix = (version: string) => `## [${version}] - `;

export function versionState(changelog: string, version: string): { index: number; dates: StoreDates } {
  if (otaVersion(version) !== undefined) {
    throw new Error(`${version} is an OTA update, not a store version. Name the store version.`);
  }
  const lines = changelog.split("\n");
  const index = lines.findIndex((line) => line.startsWith(headingPrefix(version)));
  if (index === -1) {
    throw new Error(`${MOBILE_CHANGELOG} has no "${headingPrefix(version)}" section. Prepare the version first.`);
  }
  const heading = lines[index] ?? "";
  const dates = parseStoreDates(heading.slice(headingPrefix(version).length));
  if (dates === undefined) throw new Error(`"${heading}" in ${MOBILE_CHANGELOG} is not a valid mobile heading.`);
  return { index, dates };
}

function withStoreState(
  changelog: string,
  version: string,
  stores: readonly MobileStore[],
  state: StoreState | undefined,
): string {
  const { index, dates } = versionState(changelog, version);
  for (const store of stores) {
    if (state === undefined) delete dates[store];
    else dates[store] = state;
  }
  const lines = changelog.split("\n");
  lines[index] = `${headingPrefix(version)}${formatStoreDates(dates)}`;
  return lines.join("\n");
}

export function olderInReview(changelog: string, version: string, store: MobileStore): string[] {
  return changelog.split("\n").flatMap((line) => {
    const [, candidate = "", text = ""] = /^## \[([^\]]+)\] - (.+)$/.exec(line) ?? [];
    const dates = parseStoreDates(text);
    return dates !== undefined &&
      dates[store] === undefined &&
      otaVersion(candidate) === undefined &&
      isNewerMobileVersion(version, candidate)
      ? [candidate]
      : [];
  });
}

const QUOTED_VERSION = (store: MobileStore) => new RegExp(`(\\n\\s+${store}: \\{ upTo: ")([^"]+)(")`, "g");
const LATEST_VERSION = (store: MobileStore) => new RegExp(`(\\n\\s+${store}: ")([^"]+)(")`, "g");

export function withStoreFeatures(source: string, store: MobileStore, version: string): string {
  if (otaVersion(version) !== undefined) throw new Error(`${version} is an OTA update, not a store version.`);
  const raise = (_match: string, start: string, current: string, end: string) =>
    `${start}${current !== "0" && isNewerMobileVersion(version, current) ? version : current}${end}`;
  const features = source.replace(QUOTED_VERSION(store), raise);
  const next = features.replace(LATEST_VERSION(store), raise);
  if (
    (source.match(QUOTED_VERSION(store)) ?? []).length === 0 ||
    (source.match(LATEST_VERSION(store)) ?? []).length !== 1
  ) {
    throw new Error(`${MOBILE_FEATURES_CONFIG_FILE} does not have the expected ${store} entries.`);
  }
  return next;
}

export interface PublishPlan {
  changes: FileChange[];
  skipped: { version: string; store: MobileStore }[];
  announcementProblems: string[];
}

export function publishPlan(version: string, stores: readonly MobileStore[], skipOlder: boolean): PublishPlan {
  let changelog = readText(MOBILE_CHANGELOG);
  const { dates } = versionState(changelog, version);
  const done = stores.filter((store) => storeDay(dates, store) !== undefined);
  if (done.length > 0) {
    const names = done.map((store) => MOBILE_STORE_NAMES[store]).join(" and ");
    throw new Error(`${version} is already available on ${names}. Name only the other store.`);
  }
  const day = today();
  changelog = withStoreState(changelog, version, stores, day);
  const skipped = skipOlder
    ? stores.flatMap((store) => olderInReview(changelog, version, store).map((older) => ({ version: older, store })))
    : [];
  for (const entry of skipped) changelog = withStoreState(changelog, entry.version, [entry.store], SKIPPED);

  const problems = releaseNotesProblems(changelog, version, { storeReview: true });
  if (problems.length > 0) {
    throw new Error(
      [`The release notes for ${version} are not ready:`, ...problems.map((problem) => `- ${problem}`)].join("\n"),
    );
  }

  let config = readText(MOBILE_FEATURES_CONFIG_FILE);
  for (const store of stores) config = withStoreFeatures(config, store, version);

  const names = stores.map((store) => MOBILE_STORE_NAMES[store]).join(" and ");
  const changes: FileChange[] = [
    {
      path: MOBILE_CHANGELOG,
      text: changelog,
      summary: [
        `${version}: ${formatStoreDates(versionState(changelog, version).dates)}`,
        ...skipped.map((entry) => `${entry.version}: ${SKIPPED} (${MOBILE_STORE_NAMES[entry.store]})`),
      ].join("; "),
    },
  ];
  if (config !== readText(MOBILE_FEATURES_CONFIG_FILE)) {
    changes.push({
      path: MOBILE_FEATURES_CONFIG_FILE,
      text: config,
      summary: `${names} feature flags up to ${version} (a flag at "0" stays off), newest ${names} version ${version}`,
    });
  }
  return {
    changes,
    skipped,
    announcementProblems: mobileAnnouncementProblems(readText(MOBILE_ANNOUNCEMENT_FILE), version),
  };
}

export function skipPlan(version: string, store: MobileStore, undo: boolean): FileChange[] {
  const changelog = readText(MOBILE_CHANGELOG);
  const { dates } = versionState(changelog, version);
  const name = MOBILE_STORE_NAMES[store];
  if (storeDay(dates, store) !== undefined)
    throw new Error(`${version} is available on ${name}, so it is not skipped.`);
  if (undo && dates[store] !== SKIPPED) throw new Error(`${version} is not skipped on ${name}.`);
  if (!undo && dates[store] === SKIPPED) throw new Error(`${version} is already skipped on ${name}.`);
  const next = withStoreState(changelog, version, [store], undo ? undefined : SKIPPED);
  return [
    {
      path: MOBILE_CHANGELOG,
      text: next,
      summary: `${version}: ${formatStoreDates(versionState(next, version).dates)}`,
    },
  ];
}

export function pendingFragments(): number {
  return readdirSync(MOBILE_FRAGMENT_DIR, { recursive: true }).filter(
    (name) => String(name).endsWith(".md") && String(name) !== "README.md",
  ).length;
}

export function run(command: string, args: readonly string[], options: { quiet?: boolean } = {}): string {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", options.quiet ? "ignore" : "inherit"],
  }).trim();
}

export function assertCleanTree(): void {
  if (run("git", ["status", "--porcelain"]) !== "") {
    throw new Error("The working tree has changes. Commit or move them first: the release step switches branches.");
  }
}

export function startBranch(name: string): string {
  run("git", ["fetch", "origin", "main"]);
  const taken = (branch: string) => {
    try {
      run("git", ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], { quiet: true });
      return true;
    } catch {
      return false;
    }
  };
  let branch = name;
  for (let attempt = 2; taken(branch); attempt += 1) branch = `${name}-${attempt}`;
  run("git", ["switch", "--quiet", "-c", branch, "--no-track", "origin/main"]);
  return branch;
}

export interface PullRequest {
  title: string;
  body: string;
  paths: readonly string[];
  autoMerge: boolean;
}

export function openPullRequest({ title, body, paths, autoMerge }: PullRequest): string {
  run("git", ["add", "--", ...paths]);
  execFileSync("git", ["commit", "--quiet", "-m", title], { stdio: "inherit" });
  run("git", ["push", "--quiet", "-u", "origin", "HEAD"]);
  const url = run("gh", ["pr", "create", "--base", "main", "--title", title, "--body", body]);
  if (autoMerge) run("gh", ["pr", "merge", url, "--auto", "--squash"]);
  return url;
}

export interface PullRequestBody {
  linked: string;
  changed: readonly string[];
  surfaces: string;
  verification: string;
  next?: string;
}

export function pullRequestBody({ linked, changed, surfaces, verification, next }: PullRequestBody): string {
  return [
    "## Linked issue",
    "",
    linked,
    "",
    "## Type of change",
    "",
    "- [x] Small improvement or alignment, with no change to how a feature works",
    "",
    "## What changed",
    "",
    ...changed.map((line) => `- ${line}`),
    "",
    `Surfaces: ${surfaces}`,
    ...(next ? ["", next] : []),
    "",
    "## Verification",
    "",
    `- [x] ${verification}`,
    '- [x] Surfaces touched are named under "What changed"',
    "- [x] Relevant manual smoke test completed, or not applicable",
    "- [x] No credentials, private data, generated output, or real user files are included",
    "",
    "## Risk and security impact",
    "",
    "None.",
    "",
    "Made with `bun run mobile:release`.",
    "",
  ].join("\n");
}
