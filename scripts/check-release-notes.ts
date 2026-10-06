// Stops a release whose CHANGELOG.md section is missing, empty or malformed.
//
//   bun scripts/check-release-notes.ts           checks the package.json version on disk
//   bun scripts/check-release-notes.ts --staged  checks the index, only when the commit changes the version
//   bun scripts/check-release-notes.ts [--staged] --fragments <path>...  checks changelog.d fragments
//   --mobile checks the version of apps/mobile/app.json in apps/mobile/CHANGELOG.md instead, and
//            accepts "In review" as its date
//   --no-pending also stops when notes wait for a version: in the fragment folder or under Unreleased
//
// No package imports: `release.yml` runs this before `bun install`.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FRAGMENT_DIR,
  fragmentProblems,
  MOBILE_CHANGELOG,
  MOBILE_FRAGMENT_DIR,
  MOBILE_VERSION_FILES,
  releaseNotesProblems,
  unreleasedItems,
} from "./release-notes";

const staged = process.argv.includes("--staged");
const mobile = process.argv.includes("--mobile");
const versionFile = mobile ? MOBILE_VERSION_FILES[0] : "package.json";
const changelogFile = mobile ? MOBILE_CHANGELOG : "CHANGELOG.md";
const product = mobile ? "OpenBot for iPhone" : "OpenBot";

const show = (object: string): string | undefined => {
  try {
    return execFileSync("git", ["show", object], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return undefined;
  }
};

const fragmentsFlag = process.argv.indexOf("--fragments");
if (fragmentsFlag !== -1) {
  const problems = process.argv
    .slice(fragmentsFlag + 1)
    .flatMap((path) =>
      fragmentProblems((staged ? show(`:${path}`) : readFileSync(path, "utf8")) ?? "").map(
        (problem) => `- ${path}: ${problem}`,
      ),
    );
  if (problems.length > 0) {
    process.stderr.write(
      ["These release notes are not ready:", ...problems, "", "See docs/RELEASING.md#release-notes.", ""].join("\n"),
    );
    process.exit(1);
  }
  process.exit(0);
}

function version(json: string | undefined): string | undefined {
  if (json === undefined) return undefined;
  const parsed = JSON.parse(json);
  // `app.json` keeps the version under `expo`.
  const value = mobile ? parsed?.expo?.version : parsed?.version;
  return typeof value === "string" ? value : undefined;
}

const nextVersion = version(staged ? show(`:${versionFile}`) : readFileSync(versionFile, "utf8"));
if (nextVersion === undefined) {
  process.stderr.write(`${versionFile} has no version.\n`);
  process.exit(1);
}
if (staged && version(show(`HEAD:${versionFile}`)) === nextVersion) process.exit(0);

const problems = releaseNotesProblems(
  (staged ? show(`:${changelogFile}`) : readFileSync(changelogFile, "utf8")) ?? "",
  nextVersion,
  // A new mobile version waits for store review before `/changelog` shows it.
  { inReview: mobile },
);
if (problems.length > 0) {
  process.stderr.write(
    [
      `The release notes for ${product} ${nextVersion} are not ready:`,
      ...problems.map((problem) => `- ${problem}`),
      "",
      `Write them in ${changelogFile} before the release. See docs/RELEASING.md#release-notes.`,
      "",
    ].join("\n"),
  );
  process.exit(1);
}

// Every TestFlight upload reaches open testers, so it is a release. Notes that wait for a version
// would ship with no entry on /changelog, under a version that testers already have.
if (process.argv.includes("--no-pending")) {
  const fragmentDir = mobile ? MOBILE_FRAGMENT_DIR : FRAGMENT_DIR;
  const fragments = existsSync(fragmentDir)
    ? readdirSync(fragmentDir, { recursive: true, encoding: "utf8" })
        .filter((name) => name.endsWith(".md") && name !== "README.md")
        .map((name) => join(fragmentDir, name))
    : [];
  const unreleased = unreleasedItems(readFileSync(changelogFile, "utf8"));
  if (fragments.length > 0 || unreleased.length > 0) {
    process.stderr.write(
      [
        `These notes have no version. ${product} ${nextVersion} is already released:`,
        ...fragments.map((path) => `- ${path}`),
        ...(unreleased.length > 0 ? [`- ${unreleased.length} items under "## [Unreleased]" in ${changelogFile}`] : []),
        "",
        mobile
          ? "Run bun run mobile:release:patch (or minor, major), merge the change to main, then release again."
          : "Run bun run release:patch (or minor, major) first.",
        "",
      ].join("\n"),
    );
    process.exit(1);
  }
}
