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
import { frozenMigrationProblems, MIGRATIONS_DIR } from "./frozen-migrations";

function git(...args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 << 20 });
}

function newestReleaseTag(): string {
  let tags: string;
  try {
    tags = git("ls-remote", "--tags", "--refs", "--sort=-v:refname", "origin", "v*");
  } catch {
    tags = git("tag", "--list", "--sort=-v:refname", "v*");
  }
  const newest = /(?:^|\/)(v\d+\.\d+\.\d+)$/m.exec(tags)?.[1];
  if (!newest) throw new Error("No v* release tag on origin or in this checkout.");
  return newest;
}

const tagFlag = process.argv.indexOf("--tag");
const tag = tagFlag === -1 ? newestReleaseTag() : (process.argv[tagFlag + 1] ?? "");
try {
  git("rev-parse", "--verify", "--quiet", `refs/tags/${tag}^{commit}`);
} catch {
  git("fetch", "--quiet", "--no-tags", "--depth=1", "origin", `refs/tags/${tag}:refs/tags/${tag}`);
}

const releasedFiles = new Map<string, string>();
for (const path of git("ls-tree", "--name-only", tag, "--", `${MIGRATIONS_DIR}/`).split("\n").filter(Boolean)) {
  releasedFiles.set(path.slice(MIGRATIONS_DIR.length + 1), git("show", `${tag}:${path}`));
}
const current = new Map(
  readdirSync(MIGRATIONS_DIR).map((file) => [file, readFileSync(join(MIGRATIONS_DIR, file), "utf8")]),
);

const problems = frozenMigrationProblems(current, { tag, files: releasedFiles });
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
process.stdout.write(`Migrations are frozen: ${tag}, ${scope}.\n`);
