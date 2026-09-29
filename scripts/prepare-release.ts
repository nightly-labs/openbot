import { execFileSync } from "node:child_process";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isDynamicRecord, isOneOf, isString } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger } from "@openbot/logging";
import {
  assembleSection,
  FRAGMENT_DIR,
  MOBILE_CHANGELOG,
  MOBILE_FRAGMENT_DIR,
  MOBILE_VERSION_FILES,
  releaseNotesProblems,
  UNRELEASED,
} from "./release-notes";

//   bun scripts/prepare-release.ts <major|minor|patch>           the desktop app and the web client
//   bun scripts/prepare-release.ts <major|minor|patch> --mobile  the iPhone app

const logger = createOpenBotLogger("prepare-release");

type Increment = "major" | "minor" | "patch";

interface ReleaseTarget {
  name: string;
  changelog: string;
  fragmentDir: string;
  /** Each file that holds the version. The first one is where the current version is read. */
  versionFiles: readonly string[];
  next: string;
}

const DESKTOP: ReleaseTarget = {
  name: "OpenBot",
  changelog: "CHANGELOG.md",
  fragmentDir: FRAGMENT_DIR,
  versionFiles: ["package.json"],
  next: "commit package.json, CHANGELOG.md and changelog.d, push, run preflight, then tag it",
};

const MOBILE: ReleaseTarget = {
  name: "OpenBot for iPhone",
  changelog: MOBILE_CHANGELOG,
  fragmentDir: MOBILE_FRAGMENT_DIR,
  versionFiles: MOBILE_VERSION_FILES,
  next: "commit the files, merge them to main, then run bun run mobile:ios:release:testflight",
};

/** The first `"version"` in the file, which is the top-level one in each file that this script changes. */
const VERSION_FIELD = /("version"\s*:\s*")([^"]*)(")/;

const args = process.argv.slice(2);
const increment = args.find((arg) => !arg.startsWith("--"));
if (!isOneOf(["major", "minor", "patch"] as const, increment)) {
  throw new Error("Usage: bun scripts/prepare-release.ts <major|minor|patch> [--mobile]");
}
const target = args.includes("--mobile") ? MOBILE : DESKTOP;

const versionSources = await Promise.all(target.versionFiles.map((path) => readFile(path, "utf8")));
const versions = versionSources.map((source, index) => fileVersion(source, target.versionFiles[index] ?? ""));
const currentVersion = versions[0] ?? "";
if (versions.some((version) => version !== currentVersion)) {
  throw new Error(`${target.versionFiles.join(" and ")} must have the same version.`);
}
const changelog = await readFile(target.changelog, "utf8");
const nextVersion = bumpVersion(currentVersion, increment);
const releaseHeading = `## [${nextVersion}] - ${new Date().toISOString().slice(0, 10)}`;
if (changelog.includes(`## [${nextVersion}]`)) {
  throw new Error(`${target.changelog} already contains ${nextVersion}`);
}

// The release is the items still written under Unreleased, then each fragment in the order that
// its pull request merged. Unreleased stays as an empty heading.
const lines = changelog.split("\n");
const unreleased = lines.findIndex((line) => line.startsWith(`## [${UNRELEASED}]`));
if (unreleased === -1) throw new Error(`${target.changelog} has no "## [${UNRELEASED}]" section.`);
const nextRelease = lines.findIndex((line, index) => index > unreleased && line.startsWith("## "));
const unreleasedEnd = nextRelease === -1 ? lines.length : nextRelease;
const fragments = await releaseFragments(target.fragmentDir);
const section = assembleSection([
  lines.slice(unreleased + 1, unreleasedEnd).join("\n"),
  ...(await Promise.all(fragments.map((path) => readFile(path, "utf8")))),
]);
const nextChangelog = [
  ...lines.slice(0, unreleased + 1),
  "",
  releaseHeading,
  "",
  section,
  "",
  ...lines.slice(unreleasedEnd),
].join("\n");

const problems = releaseNotesProblems(nextChangelog, nextVersion);
if (problems.length > 0) {
  throw new Error(
    [
      `Write the release notes for ${nextVersion} in ${target.fragmentDir}/ first:`,
      ...problems.map((problem) => `- ${problem}`),
      "See docs/RELEASING.md#release-notes.",
    ].join("\n"),
  );
}

await Promise.all([
  ...target.versionFiles.map((path, index) =>
    writeFile(path, withVersion(versionSources[index] ?? "", path, nextVersion)),
  ),
  writeFile(target.changelog, nextChangelog),
]);
// Only after the changelog holds their items.
await Promise.all(fragments.map((path) => rm(path)));

logger.info(`Prepared ${target.name} v${nextVersion} from ${fragments.length} fragments. Review, then ${target.next}.`);

function fileVersion(source: string, path: string): string {
  const version = VERSION_FIELD.exec(source)?.[2];
  const parsed = JSON.parse(source);
  // `app.json` keeps the version under `expo`. The `expo` key of a `package.json` has none.
  const record = path.endsWith("app.json") && isDynamicRecord(parsed) ? parsed.expo : parsed;
  const expected = isDynamicRecord(record) ? record.version : undefined;
  if (version === undefined || !isString(expected) || version !== expected) {
    throw new Error(`${path} has no valid version.`);
  }
  return version;
}

/** Changes only the version, so the file keeps the layout that Biome gave it. */
function withVersion(source: string, path: string, version: string): string {
  const next = source.replace(VERSION_FIELD, `$1${version}$3`);
  if (fileVersion(next, path) !== version) throw new Error(`Could not set the version in ${path}.`);
  return next;
}

/** The fragments in `directory`, oldest commit first. A fragment with no commit is last. */
async function releaseFragments(directory: string): Promise<string[]> {
  // Recursive, as the hook and the workflow check a fragment in a subdirectory too.
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

function bumpVersion(version: string, selectedIncrement: Increment): string {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`Package version is not semver: ${version}`);

  let major = Number(match[1]);
  let minor = Number(match[2]);
  let patch = Number(match[3]);
  if (selectedIncrement === "major") {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (selectedIncrement === "minor") {
    minor += 1;
    patch = 0;
  } else {
    patch += 1;
  }
  return `${major}.${minor}.${patch}`;
}
