// The file changes of each mobile release step, and the pull request that carries them. The menu
// `bun run mobile:release` (scripts/mobile-release.ts) and `bun run mobile:release:published`
// (scripts/publish-mobile-release.ts) use them. Each step reads the files, returns the new text of
// each one, and writes nothing, so a step that cannot finish changes nothing.

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
  /** One line for the summary, such as "1.4.7: 2026-11-06 (iOS)". */
  summary: string;
}

export function readText(path: string): string {
  return readFileSync(path, "utf8");
}

export function appVersion(): string {
  const appJson = JSON.parse(readText(MOBILE_VERSION_FILES[0]));
  const version = isDynamicRecord(appJson) && isDynamicRecord(appJson.expo) ? appJson.expo.version : undefined;
  if (!isString(version)) throw new Error(`${MOBILE_VERSION_FILES[0]} has no valid version.`);
  return version;
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const headingPrefix = (version: string) => `## [${version}] - `;

/** The heading state of `version`, and the line it is on. */
export function versionState(changelog: string, version: string): { index: number; dates: StoreDates } {
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

/** `changelog` with the state of `stores` in the heading of `version` replaced. */
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

/** The versions older than `version` that `store` still reviews. A newer build replaces them. */
export function olderInReview(changelog: string, version: string, store: MobileStore): string[] {
  return changelog.split("\n").flatMap((line) => {
    const [, candidate = "", text = ""] = /^## \[([^\]]+)\] - (.+)$/.exec(line) ?? [];
    const dates = parseStoreDates(text);
    return dates !== undefined && dates[store] === undefined && isNewerMobileVersion(version, candidate)
      ? [candidate]
      : [];
  });
}

const QUOTED_VERSION = (store: MobileStore) => new RegExp(`(\\n\\s+${store}: \\{ upTo: ")([^"]+)(")`, "g");
const LATEST_VERSION = (store: MobileStore) => new RegExp(`(\\n\\s+${store}: ")([^"]+)(")`, "g");

/**
 * The feature config with the `upTo` of each feature and the newest version of `store` raised to
 * `version`. A version that is not newer leaves the file as it is, and so does "0", which turns a
 * feature off for every version. `except` lists stay.
 */
export function withStoreFeatures(source: string, store: MobileStore, version: string): string {
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
  /** The older versions that the step marks as skipped on each store. */
  skipped: { version: string; store: MobileStore }[];
  /** What stops the Discord post. The step works, but the merge cannot post until the file is ready. */
  announcementProblems: string[];
}

/**
 * Marks `version` as available on `stores` today, raises their flags and newest version, and, with
 * `skipOlder`, marks the older versions that those stores still review as skipped.
 */
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

/** Marks `version` as skipped on `store`, or, with `undo`, as in review again. */
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

/** The release notes that wait in apps/mobile/changelog.d for the next version. */
export function pendingFragments(): number {
  return readdirSync(MOBILE_FRAGMENT_DIR, { recursive: true }).filter(
    (name) => String(name).endsWith(".md") && String(name) !== "README.md",
  ).length;
}

// ---------------------------------------------------------------------------------------------
// The pull request.

export function run(command: string, args: readonly string[], options: { quiet?: boolean } = {}): string {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", options.quiet ? "ignore" : "inherit"],
  }).trim();
}

/** Stops when the working tree has changes, because the step switches branches. */
export function assertCleanTree(): void {
  if (run("git", ["status", "--porcelain"]) !== "") {
    throw new Error("The working tree has changes. Commit or move them first: the release step switches branches.");
  }
}

/** A branch from the main of GitHub, so the step never carries local commits. */
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

/** Commits `paths`, pushes the branch and opens the pull request. Returns its URL. */
export function openPullRequest({ title, body, paths, autoMerge }: PullRequest): string {
  run("git", ["add", "--", ...paths]);
  // The pre-commit hook runs here, with its checks.
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

/** The body of a release pull request, in the shape of .github/PULL_REQUEST_TEMPLATE.md. */
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
