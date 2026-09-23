import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The hook stages Biome's fixes again after `check:staged`. A commit must still hold only what the
// author staged: an unstaged edit in the same file is the author's work in progress.

const HOOKS = resolve(import.meta.dirname, "../.githooks");

// Stands in for Biome: rewrites "unformatted" in each staged file on disk, as `--write` does.
const FORMATTER = `
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
const staged = execFileSync("git", ["diff", "--cached", "--name-only"], { encoding: "utf8" });
for (const path of staged.split("\\n").filter(Boolean)) {
  if (!existsSync(path)) continue;
  writeFileSync(path, readFileSync(path, "utf8").replaceAll("unformatted", "formatted"));
}
`;

function repository() {
  const root = mkdtempSync(join(tmpdir(), "pre-commit-hook-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" });
  git("init", "--quiet");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  writeFileSync(join(root, "package.json"), JSON.stringify({ scripts: { "check:staged": "node format.mjs" } }));
  writeFileSync(join(root, "format.mjs"), FORMATTER);
  writeFileSync(join(root, "notes.md"), "first\nmiddle\nlast\n");
  git("add", ".");
  git("commit", "--quiet", "--message", "base");
  git("config", "core.hooksPath", HOOKS);
  const write = (text: string) => writeFileSync(join(root, "notes.md"), text);
  const stagePatch = (patch: string) =>
    execFileSync("git", ["apply", "--cached", "-"], { cwd: root, input: patch, stdio: "pipe" });
  return { root, git, write, stagePatch };
}

// Adds a line before "middle" in the index only.
const STAGE_FIRST_LINE = (added: string) =>
  ["--- a/notes.md", "+++ b/notes.md", "@@ -1,3 +1,4 @@", " first", `+${added}`, " middle", " last", ""].join("\n");

describe("pre-commit hook", () => {
  it("commits only the staged part of a partly staged file", () => {
    const { git, write, stagePatch } = repository();
    write("first\nstaged\nmiddle\nlast\nunstaged\n");
    stagePatch(STAGE_FIRST_LINE("staged"));

    git("commit", "--quiet", "--message", "partial");

    expect(git("show", "HEAD:notes.md")).toBe("first\nstaged\nmiddle\nlast\n");
    expect(git("diff", "--name-only")).toBe("notes.md\n");
  });

  it("stages the formatter's fixes to a fully staged file", () => {
    const { git, write } = repository();
    write("first\nunformatted\nmiddle\nlast\n");
    git("add", "notes.md");

    git("commit", "--quiet", "--message", "full");

    expect(git("show", "HEAD:notes.md")).toBe("first\nformatted\nmiddle\nlast\n");
  });

  it("stops the commit when the formatter changes a partly staged file", () => {
    const { root, git, write, stagePatch } = repository();
    write("first\nunformatted\nmiddle\nlast\nunstaged\n");
    stagePatch(STAGE_FIRST_LINE("unformatted"));

    expect(() => git("commit", "--quiet", "--message", "partial")).toThrow(
      /Biome fixed files that also have unstaged changes:\n {2}notes\.md/,
    );
    expect(git("rev-list", "--count", "HEAD")).toBe("1\n");
    expect(git("show", ":notes.md")).toBe("first\nunformatted\nmiddle\nlast\n");
    expect(readFileSync(join(root, "notes.md"), "utf8")).toBe("first\nformatted\nmiddle\nlast\nunstaged\n");
  });
});
