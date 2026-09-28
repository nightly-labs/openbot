// Stops a release whose CHANGELOG.md section is missing, empty or malformed.
//
//   bun scripts/check-release-notes.ts           checks the package.json version on disk
//   bun scripts/check-release-notes.ts --staged  checks the index, only when the commit changes the version
//   bun scripts/check-release-notes.ts [--staged] --fragments <path>...  checks changelog.d fragments
//
// No package imports: `release.yml` runs this before `bun install`.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { FRAGMENT_DIR, fragmentProblems, releaseNotesProblems } from "./release-notes";

const staged = process.argv.includes("--staged");

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
      [
        `The release notes in ${FRAGMENT_DIR} are not ready:`,
        ...problems,
        "",
        "See docs/RELEASING.md#release-notes.",
        "",
      ].join("\n"),
    );
    process.exit(1);
  }
  process.exit(0);
}

function version(packageJson: string | undefined): string | undefined {
  if (packageJson === undefined) return undefined;
  const value = JSON.parse(packageJson)?.version;
  return typeof value === "string" ? value : undefined;
}

const nextVersion = version(staged ? show(":package.json") : readFileSync("package.json", "utf8"));
if (nextVersion === undefined) {
  process.stderr.write("package.json has no version.\n");
  process.exit(1);
}
if (staged && version(show("HEAD:package.json")) === nextVersion) process.exit(0);

const problems = releaseNotesProblems(
  (staged ? show(":CHANGELOG.md") : readFileSync("CHANGELOG.md", "utf8")) ?? "",
  nextVersion,
);
if (problems.length > 0) {
  process.stderr.write(
    [
      `The release notes for OpenBot ${nextVersion} are not ready:`,
      ...problems.map((problem) => `- ${problem}`),
      "",
      "Write them in CHANGELOG.md before the release. See docs/RELEASING.md#release-notes.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}
