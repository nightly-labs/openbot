// The Discord posts of a mobile release. Android and iOS review a build on their own, often days
// apart, so each store gets its own post when it has the version: "OpenBot v1.4.7 is out on iOS",
// with a line about the other store. When both stores have it at the same time, one post names both.
//
// A post goes out only when users can see the version: the production account Worker must list it
// in `/v1/mobile/changelog` and give its flags in `/v1/mobile/features`, as the repository has them.
// The Worker deploys after CI on main, and CI can be cancelled by a newer push, so the post follows
// the live state and not one CI run. A tag `mobile-announced/v<version>/<store>` records each post,
// so a re-run, a schedule run or a cancelled run never posts twice and never loses a post.
// `mobile-release-announcement.yml` runs `announce`. See apps/mobile/README.md#discord-announcement.
//
//   bun scripts/discord-mobile-release-announcement.ts available <old CHANGELOG.md>
//       prints the version that got a store date since <old CHANGELOG.md>, or nothing
//   bun scripts/discord-mobile-release-announcement.ts check <version> [ios|android|both]
//       checks the highlights and prints the message of each store that has the version
//   bun scripts/discord-mobile-release-announcement.ts plan      prints the posts that are due, and why others wait
//   bun scripts/discord-mobile-release-announcement.ts announce  posts each due post and tags it
//   bun scripts/discord-mobile-release-announcement.ts announce --version <x.y.z> --stores <ios|android|both> [--again]
//       posts that version; --again posts it even when it has a tag
//   bun scripts/discord-mobile-release-announcement.ts mark-posted <version> <ios|android|both>
//       tags a post that was sent by hand, so it is not sent again
//
// `plan`, `announce` and `mark-posted` read the tags with GH_TOKEN (or `gh auth token`) and
// GITHUB_REPOSITORY (or the `origin` remote). `--site <url>` and `--github-api <url>` replace
// production, for the E2E script.
//
// No package imports: the workflow runs this before `bun install`.

import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { MOBILE_FEATURE_CONFIG } from "../apps/auth-api/src/server/mobile-features-config";
import {
  isNewerMobileVersion,
  MOBILE_CHANGELOG_PATH,
  MOBILE_FEATURES,
  MOBILE_FEATURES_PATH,
  parseMobileFeatureFlags,
  parseMobileLatestVersion,
  parseMobileReleaseNotes,
  resolveMobileFeatures,
} from "../packages/contracts/src/mobile-features";
import { ANDROID_PLAY_STORE_URL } from "../packages/ui/src/features/mobile-app/android-play-store";
import { IOS_APP_STORE_URL } from "../packages/ui/src/features/mobile-app/ios-app-store";
import {
  announcementFileProblems,
  LONGEST_ROLE_ID,
  postAnnouncement,
  releaseAnchor,
  roleIdProblems,
} from "./discord-announcement";
import {
  MOBILE_CHANGELOG,
  MOBILE_STORE_NAMES,
  MOBILE_STORES,
  type MobileStore,
  parseStoreDates,
  SKIPPED,
  type StoreDates,
  storeDay,
} from "./release-notes";

export const MOBILE_ANNOUNCEMENT_FILE = "apps/mobile/release-announcement.json";
const DOCS = "apps/mobile/README.md#discord-announcement";
/** The ID of the "Mobile Release Pings" role. A GitHub variable of the `release-mobile` environment. */
const ROLE_VARIABLE = "DISCORD_MOBILE_RELEASE_ROLE_ID";
const WEBHOOK_VARIABLE = "DISCORD_MOBILE_RELEASE_WEBHOOK_URL";
const PRODUCTION_SITE = "https://openbot.run";
const GITHUB_API = "https://api.github.com";
export const ANNOUNCED_TAG_PREFIX = "mobile-announced/";
/**
 * The first version that gets its posts from the tags. Older versions were posted before the tags
 * existed, so `announce` never posts them without `--version`.
 */
const FIRST_TAGGED_VERSION = "1.4.7";
const STORE_LINKS: Record<MobileStore, string> = { ios: IOS_APP_STORE_URL, android: ANDROID_PLAY_STORE_URL };

/** The heading state of each version in `changelog`, newest first. */
export function mobileVersions(changelog: string): { version: string; dates: StoreDates }[] {
  return changelog.split(/\r?\n/).flatMap((line) => {
    const [, version = "", text = ""] = /^## \[([^\]]+)\] - (.+)$/.exec(line) ?? [];
    const dates = parseStoreDates(text);
    return dates === undefined ? [] : [{ version, dates }];
  });
}

/** The stores of `version` that have a date in `changelog` and not in `before`. */
export function newlyAvailable(before: string, changelog: string): { version: string; stores: MobileStore[] }[] {
  const old = new Map(mobileVersions(before).map((entry) => [entry.version, entry.dates]));
  return mobileVersions(changelog).flatMap(({ version, dates }) => {
    const stores = MOBILE_STORES.filter(
      (store) => storeDay(dates, store) !== undefined && storeDay(old.get(version) ?? {}, store) === undefined,
    );
    return stores.length > 0 ? [{ version, stores }] : [];
  });
}

export function announcedTag(version: string, store: MobileStore): string {
  return `${ANNOUNCED_TAG_PREFIX}v${version}/${store}`;
}

/** What stops `announcement` from being posted for `version`. Empty when it is ready. */
export function mobileAnnouncementProblems(announcement: string, version: string): string[] {
  return announcementFileProblems(announcement, version, MOBILE_ANNOUNCEMENT_FILE, (highlights) =>
    // The longest form: the second store, with the line about the first one and both store links.
    announcementMessage({
      highlights,
      version,
      stores: ["android"],
      dates: { ios: "2000-01-01" },
      roleId: LONGEST_ROLE_ID,
    }),
  );
}

function changelogUrl(version: string): string {
  return `https://openbot.run/changelog?platform=mobile#mobile-${releaseAnchor(version)}`;
}

const storeList = (stores: readonly MobileStore[]) => stores.map((store) => MOBILE_STORE_NAMES[store]).join(" and ");

interface MessageInput {
  highlights: readonly unknown[];
  version: string;
  /** The stores that this post is for. */
  stores: readonly MobileStore[];
  /** The changelog state of the version, for the line about each other store. */
  dates: StoreDates;
  /** Without it, the message names the role in plain text, so that `check` shows the post. */
  roleId?: string | undefined;
}

/** The line under the title about a store that this post is not for. Empty for a skipped store. */
function otherStoreLine(store: MobileStore, dates: StoreDates): string | undefined {
  if (dates[store] === SKIPPED) return undefined;
  if (storeDay(dates, store) !== undefined) return `It is already out on ${MOBILE_STORE_NAMES[store]}.`;
  return `The ${MOBILE_STORE_NAMES[store]} version comes out later.`;
}

export function announcementMessage({ highlights, version, stores, dates, roleId }: MessageInput): string {
  const others = MOBILE_STORES.filter((store) => !stores.includes(store)).flatMap(
    (store) => otherStoreLine(store, dates) ?? [],
  );
  // A store link only for a store that has the version.
  const links = MOBILE_STORES.filter((store) => stores.includes(store) || storeDay(dates, store) !== undefined).map(
    (store) => `[${MOBILE_STORE_NAMES[store]}](<${STORE_LINKS[store]}>)`,
  );
  return [
    roleId === undefined ? "@Mobile Release Pings" : `<@&${roleId}>`,
    `**OpenBot v${version} is out on ${storeList(stores)}**`,
    ...others,
    "",
    ...highlights.map((highlight) => `- ${String(highlight).trim()}`),
    "",
    // Masked links keep the footer on one line. The angle brackets stop Discord from adding a preview of each page.
    [...links, `[Full Changelog](<${changelogUrl(version)}>)`].join(" · "),
  ].join("\n");
}

// ---------------------------------------------------------------------------------------------
// The live state and the tags.

export interface Endpoints {
  site: string;
  githubApi: string;
  repository: string;
  token: string;
}

/** Reads `url` as JSON and parses it at this boundary. */
async function getJson<T>(url: string, parse: (value: unknown) => T, token?: string): Promise<T> {
  const response = await fetch(url, {
    headers: token
      ? { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "openbot-release" }
      : {},
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`GET ${new URL(url).pathname} answered ${response.status}.`);
  return parse(await response.json());
}

function tagNames(refs: unknown): string[] {
  if (!Array.isArray(refs)) return [];
  return refs.flatMap((ref) =>
    typeof ref === "object" && ref !== null && "ref" in ref && typeof ref.ref === "string"
      ? [ref.ref.replace(/^refs\/tags\//, "")]
      : [],
  );
}

/** The post tags of the repository, such as `mobile-announced/v1.4.7/ios`. */
export async function announcedTags(endpoints: Endpoints): Promise<Set<string>> {
  const url = `${endpoints.githubApi}/repos/${endpoints.repository}/git/matching-refs/tags/${ANNOUNCED_TAG_PREFIX}`;
  return new Set(await getJson(url, tagNames, endpoints.token));
}

/**
 * Why users of `store` cannot see `version` yet. Undefined when the Worker has it live. Without
 * `newest`, an older version passes too: a post with `--version` can name one.
 */
export async function liveProblem(
  site: string,
  version: string,
  store: MobileStore,
  { newest = true }: { newest?: boolean } = {},
): Promise<string | undefined> {
  const releases = (await getJson(`${site}${MOBILE_CHANGELOG_PATH}?platform=${store}`, parseMobileReleaseNotes)) ?? [];
  if (!releases.some((release) => release.version === version)) {
    return `the live /changelog does not list ${version} for ${MOBILE_STORE_NAMES[store]}`;
  }
  const { latest, live } = await getJson(
    `${site}${MOBILE_FEATURES_PATH}?platform=${store}&version=${version}`,
    (answer) => ({ latest: parseMobileLatestVersion(answer), live: parseMobileFeatureFlags(answer) }),
  );
  if (newest && latest !== version)
    return `the live newest ${MOBILE_STORE_NAMES[store]} version is ${latest ?? "none"}`;
  const expected = resolveMobileFeatures(MOBILE_FEATURE_CONFIG, store, version);
  const different = MOBILE_FEATURES.filter((feature) => live?.[feature] !== expected[feature]);
  if (different.length > 0) return `the live ${different.join(" and ")} flags are not the ones in main`;
  return undefined;
}

export interface PlannedPost {
  version: string;
  stores: MobileStore[];
}

export interface Plan {
  due: PlannedPost[];
  /** Each store of a version that has a date and no post, with the reason it waits. */
  waiting: { version: string; store: MobileStore; reason: string }[];
}

/**
 * The posts that are due: the newest dated version of each store, from FIRST_TAGGED_VERSION on, with
 * no tag, that the Worker has live, and whose highlights are in the file. An older version is old
 * news, so it waits for `--version`.
 * The stores of one version that are due at the same time share one post.
 */
export async function planPosts(changelog: string, endpoints: Endpoints): Promise<Plan> {
  const versions = mobileVersions(changelog);
  const tags = await announcedTags(endpoints);
  const due = new Map<string, MobileStore[]>();
  const waiting: Plan["waiting"] = [];
  for (const store of MOBILE_STORES) {
    const newest = versions.find(({ dates }) => storeDay(dates, store) !== undefined);
    if (newest === undefined || tags.has(announcedTag(newest.version, store))) continue;
    if (isNewerMobileVersion(FIRST_TAGGED_VERSION, newest.version)) continue;
    // The highlights file can already hold the next version when the second store ships an older one.
    const reason =
      (await liveProblem(endpoints.site, newest.version, store)) ??
      mobileAnnouncementProblems(readFileSync(MOBILE_ANNOUNCEMENT_FILE, "utf8"), newest.version)[0];
    if (reason !== undefined) waiting.push({ version: newest.version, store, reason });
    else due.set(newest.version, [...(due.get(newest.version) ?? []), store]);
  }
  return { due: [...due].map(([version, stores]) => ({ version, stores })), waiting };
}

/** Creates `tag` on `sha`. False when the tag is there already. */
async function createTag(endpoints: Endpoints, tag: string, sha: string): Promise<boolean> {
  const response = await fetch(`${endpoints.githubApi}/repos/${endpoints.repository}/git/refs`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${endpoints.token}`,
      accept: "application/vnd.github+json",
      "user-agent": "openbot-release",
    },
    body: JSON.stringify({ ref: `refs/tags/${tag}`, sha }),
    signal: AbortSignal.timeout(20_000),
  });
  // GitHub also answers 422 for a commit that it does not have, so only this message means "exists".
  if (response.status === 422 && /already exists/i.test(await response.text())) return false;
  if (!response.ok) throw new Error(`Could not create the tag ${tag}: ${response.status}.`);
  return true;
}

/** Removes `tags`. Returns the ones that GitHub did not remove, for example because of a ruleset. */
async function deleteTags(endpoints: Endpoints, tags: readonly string[]): Promise<string[]> {
  const left: string[] = [];
  for (const tag of tags) {
    const response = await fetch(`${endpoints.githubApi}/repos/${endpoints.repository}/git/refs/tags/${tag}`, {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${endpoints.token}`,
        accept: "application/vnd.github+json",
        "user-agent": "openbot-release",
      },
      signal: AbortSignal.timeout(20_000),
    }).catch(() => undefined);
    if (!response?.ok) left.push(tag);
  }
  return left;
}

/** The lines that name each tag that stays without a post. Each later run skips that post until it goes. */
function leftTagLines(left: readonly string[]): string[] {
  return left.map((tag) => `Could not remove the tag ${tag}. Delete it by hand, or the post is never sent.`);
}

function git(args: readonly string[]): string {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

/** The commit that a tag points to: the one CI checked out, or the main of GitHub. */
function tagCommit(): string {
  return process.env.GITHUB_SHA || git(["rev-parse", "origin/main"]);
}

function originRepository(): string {
  const url = git(["remote", "get-url", "origin"]);
  const [, repository = ""] = /github\.com[:/](.+?)(?:\.git)?$/.exec(url) ?? [];
  if (repository === "") throw new Error("Set GITHUB_REPOSITORY: the origin remote is not on GitHub.");
  return repository;
}

/** Production, the repository of this checkout, and the token of the environment or of `gh`. */
export function defaultEndpoints(args: readonly string[] = []): Endpoints {
  const option = (name: string) => {
    const index = args.indexOf(name);
    return index === -1 ? undefined : args[index + 1];
  };
  const token =
    process.env.GH_TOKEN ||
    process.env.GITHUB_TOKEN ||
    execFileSync("gh", ["auth", "token"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  return {
    site: option("--site") ?? PRODUCTION_SITE,
    githubApi: option("--github-api") ?? GITHUB_API,
    repository: process.env.GITHUB_REPOSITORY || originRepository(),
    token,
  };
}

// ---------------------------------------------------------------------------------------------
// The commands.

function fail(lines: readonly string[]): never {
  process.stderr.write(`${lines.join("\n")}\n`);
  process.exit(1);
}

function storesArgument(value: string | undefined): MobileStore[] {
  if (value === "both") return [...MOBILE_STORES];
  const store = MOBILE_STORES.find((candidate) => candidate === value);
  if (store === undefined) fail([`"${value ?? ""}" is not ios, android or both.`]);
  return [store];
}

/** The message of `post`, or the problems that stop it. */
function preparedMessage(
  changelog: string,
  post: PlannedPost,
  roleId: string | undefined,
): { content: string } | { problems: string[] } {
  const dates = mobileVersions(changelog).find((entry) => entry.version === post.version)?.dates;
  const problems: string[] = [];
  const missing = post.stores.filter((store) => dates === undefined || storeDay(dates, store) === undefined);
  if (missing.length > 0) {
    problems.push(
      `${MOBILE_CHANGELOG} does not show ${post.version} on ${storeList(missing)}. Run bun run mobile:release first.`,
    );
  }
  const announcement = readFileSync(MOBILE_ANNOUNCEMENT_FILE, "utf8");
  problems.push(...mobileAnnouncementProblems(announcement, post.version));
  if (problems.length > 0) return { problems };
  const content = announcementMessage({
    highlights: JSON.parse(announcement).highlights,
    version: post.version,
    stores: post.stores,
    dates: dates ?? {},
    roleId,
  });
  return { content };
}

/** Tags the post, then sends it. A failed send removes the tag, so the next run tries again. */
async function sendPost(changelog: string, post: PlannedPost, endpoints: Endpoints, again: boolean): Promise<void> {
  const roleId = process.env[ROLE_VARIABLE] || undefined;
  const roleProblems = roleIdProblems(ROLE_VARIABLE, roleId, true);
  const prepared = preparedMessage(changelog, post, roleId);
  const problems = [...roleProblems, ...("problems" in prepared ? prepared.problems : [])];
  if (problems.length > 0 || !("content" in prepared) || roleId === undefined) {
    fail([
      `The Discord post for OpenBot mobile ${post.version} is not ready:`,
      ...problems.map((problem) => `- ${problem}`),
      "",
      `See ${DOCS}.`,
    ]);
  }
  const sha = tagCommit();
  // The tag is the lock: a run that cannot create it does not post.
  const created: string[] = [];
  for (const store of post.stores) {
    const tag = announcedTag(post.version, store);
    if (await createTag(endpoints, tag, sha)) created.push(tag);
    else if (!again) {
      const left = await deleteTags(endpoints, created);
      if (left.length > 0) fail(leftTagLines(left));
      process.stdout.write(`${tag} exists, so another run posted it. Nothing to do.\n`);
      return;
    }
  }
  process.stdout.write(`${prepared.content}\n`);
  // Only this role is notified, even when a highlight or a changelog text names another one.
  const failure = await postAnnouncement(prepared.content, { parse: [], roles: [roleId] }, WEBHOOK_VARIABLE, DOCS);
  if (failure !== undefined) {
    fail([failure, ...leftTagLines(await deleteTags(endpoints, created))]);
  }
  process.stdout.write(`Posted the ${post.version} announcement for ${storeList(post.stores)} to Discord.\n`);
}

function writeOutput(name: string, value: string): void {
  const file = process.env.GITHUB_OUTPUT;
  if (file) appendFileSync(file, `${name}=${value}\n`);
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const [command, argument, third] = args;
  const option = (name: string) => {
    const index = args.indexOf(name);
    return index === -1 ? undefined : args[index + 1];
  };
  const changelog = readFileSync(MOBILE_CHANGELOG, "utf8");

  if (command === "available" && argument !== undefined) {
    // The newest one only: the announcement file holds one version, and an older one is old news.
    const [entry] = newlyAvailable(readFileSync(argument, "utf8"), changelog);
    if (entry !== undefined) process.stdout.write(`${entry.version}\n`);
    process.exit(0);
  }

  if (command === "check" && argument !== undefined) {
    const dates = mobileVersions(changelog).find((entry) => entry.version === argument)?.dates ?? {};
    const stores =
      third === undefined
        ? MOBILE_STORES.filter((store) => storeDay(dates, store) !== undefined)
        : storesArgument(third);
    const roleId = process.env[ROLE_VARIABLE] || undefined;
    const problems = roleIdProblems(ROLE_VARIABLE, roleId, false);
    if (stores.length === 0) problems.push(`${MOBILE_CHANGELOG} does not show ${argument} on a store.`);
    // Each store's own post, as the stores come out one by one; a version with both stores shows both.
    const messages = stores.map((store) => preparedMessage(changelog, { version: argument, stores: [store] }, roleId));
    for (const message of messages) if ("problems" in message) problems.push(...message.problems);
    if (problems.length > 0) {
      fail([
        `The Discord announcement for OpenBot mobile ${argument} is not ready:`,
        ...[...new Set(problems)].map((problem) => `- ${problem}`),
        "",
        `See ${DOCS}.`,
      ]);
    }
    for (const message of messages) if ("content" in message) process.stdout.write(`${message.content}\n\n`);
    process.exit(0);
  }

  if (command === "plan" || command === "announce") {
    const endpoints = defaultEndpoints(args);
    const version = option("--version");
    if (version !== undefined) {
      if (command !== "announce") fail(["--version works only with announce."]);
      const stores = storesArgument(option("--stores"));
      for (const store of stores) {
        const reason = await liveProblem(endpoints.site, version, store, { newest: false });
        if (reason !== undefined) fail([`Users cannot see ${version} yet: ${reason}.`]);
      }
      await sendPost(changelog, { version, stores }, endpoints, args.includes("--again"));
      process.exit(0);
    }
    const plan = await planPosts(changelog, endpoints);
    for (const { version: waitingVersion, store, reason } of plan.waiting) {
      process.stdout.write(`${waitingVersion} on ${MOBILE_STORE_NAMES[store]} waits: ${reason}.\n`);
    }
    for (const post of plan.due) process.stdout.write(`${post.version} on ${storeList(post.stores)} is due.\n`);
    if (plan.due.length === 0) process.stdout.write("No post is due.\n");
    writeOutput("due", plan.due.length > 0 ? "true" : "false");
    if (command === "announce") for (const post of plan.due) await sendPost(changelog, post, endpoints, false);
    process.exit(0);
  }

  if (command === "mark-posted" && argument !== undefined) {
    const endpoints = defaultEndpoints(args);
    const sha = tagCommit();
    for (const store of storesArgument(third)) {
      const tag = announcedTag(argument, store);
      process.stdout.write((await createTag(endpoints, tag, sha)) ? `Created ${tag}.\n` : `${tag} exists already.\n`);
    }
    process.exit(0);
  }

  fail([
    "Usage: bun scripts/discord-mobile-release-announcement.ts <command>",
    "  available <old CHANGELOG.md>",
    "  check <version> [ios|android|both]",
    "  plan",
    "  announce [--version <x.y.z> --stores <ios|android|both> [--again]]",
    "  mark-posted <version> <ios|android|both>",
  ]);
}
