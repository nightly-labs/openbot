// Stops a change to a migration that a release shipped, and a new migration with a wrong version.
//
//   bun scripts/check-frozen-migrations.ts              compares with the newest v* release tag
//   bun scripts/check-frozen-migrations.ts --tag v1.2.3  compares with this tag
//
// The newest tag comes from origin, so a stale local tag list does not hide a release. CI checks out
// one commit and no tags, so the script fetches that one tag commit.

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { frozenMigrationProblems, MIGRATIONS_DIR, newestVersion } from "./frozen-migrations";

const RELEASE_TAG = /^v\d+\.\d+\.\d+$/;

function git(...args: string[]): string {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
}

function newestReleaseTag(): string {
  let tags: string[];
  try {
    tags = git("ls-remote", "--tags", "--refs", "origin", "v*")
      .split("\n")
      .map((line) => line.split("\t")[1]?.replace("refs/tags/", "") ?? "");
  } catch {
    tags = git("tag", "--list", "v*").split("\n");
  }
  const versions = tags.filter((tag) => RELEASE_TAG.test(tag));
  const key = (tag: string) => tag.slice(1).split(".").map(Number);
  versions.sort((left, right) => {
    const [a, b] = [key(left), key(right)];
    return (b[0] ?? 0) - (a[0] ?? 0) || (b[1] ?? 0) - (a[1] ?? 0) || (b[2] ?? 0) - (a[2] ?? 0);
  });
  const newest = versions[0];
  if (!newest) throw new Error("No v* release tag on origin or in this checkout.");
  return newest;
}

function ensureTag(tag: string): void {
  try {
    git("rev-parse", "--verify", "--quiet", `refs/tags/${tag}^{commit}`);
  } catch {
    git("fetch", "--quiet", "--no-tags", "--depth=1", "origin", `refs/tags/${tag}:refs/tags/${tag}`);
  }
}

const tagFlag = process.argv.indexOf("--tag");
const tag = tagFlag === -1 ? newestReleaseTag() : (process.argv[tagFlag + 1] ?? "");
ensureTag(tag);

const releasedFiles = new Map<string, string>();
for (const path of git("ls-tree", "--name-only", tag, "--", `${MIGRATIONS_DIR}/`).split("\n").filter(Boolean)) {
  releasedFiles.set(path.slice(MIGRATIONS_DIR.length + 1), git("show", `${tag}:${path}`));
}
// v0.72.0 and earlier kept every migration in one module, so their newest version is read from it.
const legacySchema =
  releasedFiles.size === 0 ? git("show", `${tag}:src/backend/openbot-database-schema.ts`) : undefined;
const maxVersion = newestVersion(releasedFiles.keys(), legacySchema);

const current = new Map<string, string>();
for (const file of readdirSync(MIGRATIONS_DIR)) {
  current.set(file, readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
}

const problems = frozenMigrationProblems(current, { tag, files: releasedFiles, maxVersion });
if (problems.length > 0) {
  process.stderr.write(
    [
      `These migrations break the frozen-migration rules (compared with ${tag}):`,
      ...problems.map((problem) => `- ${MIGRATIONS_DIR}/${problem}`),
      "",
      "See src/backend/AGENTS.md#frozen-migrations.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}
const scope =
  releasedFiles.size > 0 ? `${releasedFiles.size} released files unchanged` : "no frozen files in the tag yet";
process.stdout.write(`Migrations are frozen: ${tag}, newest released version ${maxVersion}, ${scope}.\n`);
