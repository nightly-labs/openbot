import { execFileSync } from "node:child_process";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isDynamicRecord, isOneOf, isString } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger } from "@openbot/logging";
import { assembleSection, FRAGMENT_DIR, releaseNotesProblems, UNRELEASED } from "./release-notes";

const logger = createOpenBotLogger("prepare-release");

type Increment = "major" | "minor" | "patch";

const increment = process.argv[2];
if (!isOneOf(["major", "minor", "patch"] as const, increment)) {
  throw new Error("Usage: bun scripts/prepare-release.ts <major|minor|patch>");
}

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
if (!isDynamicRecord(packageJson) || !isString(packageJson.version)) {
  throw new Error("package.json has no valid version.");
}
const changelog = await readFile("CHANGELOG.md", "utf8");
const nextVersion = bumpVersion(packageJson.version, increment);
const releaseHeading = `## [${nextVersion}] - ${new Date().toISOString().slice(0, 10)}`;
if (changelog.includes(`## [${nextVersion}]`)) {
  throw new Error(`CHANGELOG.md already contains ${nextVersion}`);
}

// The release is the items still written under Unreleased, then each fragment in the order that
// its pull request merged. Unreleased stays as an empty heading.
const lines = changelog.split("\n");
const unreleased = lines.findIndex((line) => line.startsWith(`## [${UNRELEASED}]`));
if (unreleased === -1) throw new Error(`CHANGELOG.md has no "## [${UNRELEASED}]" section.`);
const nextRelease = lines.findIndex((line, index) => index > unreleased && line.startsWith("## "));
const unreleasedEnd = nextRelease === -1 ? lines.length : nextRelease;
const fragments = await releaseFragments();
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
      `Write the release notes for ${nextVersion} in ${FRAGMENT_DIR}/ first:`,
      ...problems.map((problem) => `- ${problem}`),
      "See docs/RELEASING.md#release-notes.",
    ].join("\n"),
  );
}

const nextPackageJson = { ...packageJson, version: nextVersion };

await Promise.all([
  writeFile("package.json", `${JSON.stringify(nextPackageJson, null, 2)}\n`),
  writeFile("CHANGELOG.md", nextChangelog),
]);
// Only after CHANGELOG.md holds their items.
await Promise.all(fragments.map((path) => rm(path)));

logger.info(
  `Prepared OpenBot v${nextVersion} from ${fragments.length} fragments. Review, commit ` +
    `package.json, CHANGELOG.md and ${FRAGMENT_DIR}, push, run preflight, then tag it.`,
);

/** The fragments in `changelog.d`, oldest commit first. A fragment with no commit is last. */
async function releaseFragments(): Promise<string[]> {
  const names = (await readdir(FRAGMENT_DIR)).filter((name) => name.endsWith(".md") && name !== "README.md");
  const added = (path: string) => {
    const time = execFileSync("git", ["log", "--diff-filter=A", "--format=%ct", "-1", "--", path], {
      encoding: "utf8",
    }).trim();
    return time === "" ? Number.POSITIVE_INFINITY : Number(time);
  };
  return names
    .map((name) => join(FRAGMENT_DIR, name))
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
