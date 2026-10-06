// Runs the `typecheck:*` scripts whose project can see a staged file, one at a time.
//
//   bun scripts/staged-typecheck.ts                       checks the paths in the index
//   bun scripts/staged-typecheck.ts --dry-run [<path>...]  prints the selection and runs nothing;
//                                                          paths replace the index
//
// The pre-commit hook calls this. `bun run typecheck` starts all projects at the same time; that
// takes about 8 GB of memory, and several worktrees can commit at once. CI still checks every project.
//
// A project can see a file when one of these is true:
// - its tsconfig `include` matches the file's folder;
// - the file is in its workspace package, or in a workspace package that it depends on;
// - one of its files imports the file through a relative path (`RELATIVE_IMPORTS`).
// A root `tsconfig*.json`, `package.json` or `bun.lock` selects all projects.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, posix, relative, resolve } from "node:path";
import { MOBILE_CODEGEN_INPUTS } from "./mobile-codegen";

const ROOT = resolve(import.meta.dirname, "..");

const TYPE_INPUT = /\.(ts|tsx|mts|cts|js|mjs|cjs)$|(^|\/)(tsconfig[^/]*\.json|package\.json)$/;
const SELECTS_ALL = /^(tsconfig[^/]*\.json|package\.json|bun\.lock)$/;

// Imports across project folders that no `include` or package dependency shows. Find them with a
// search for `from "../` paths that leave a project folder.
const RELATIVE_IMPORTS: Record<string, string[]> = {
  // Tests in `scripts` import mobile models; `stripe-flows-e2e.ts` imports the account Worker.
  "typecheck:node": ["apps/mobile/src", "apps/auth-api/src"],
  // The account Worker routes hosted sites with the site router.
  "typecheck:api": ["apps/site-router/src"],
};

interface PackageJson {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  workspaces?: { packages: string[] };
}

interface Project {
  script: string;
  /** Folders and files, relative to the repository root, that select the project. */
  roots: string[];
}

function readJson<T>(path: string): T {
  const parsed: T = JSON.parse(readFileSync(join(ROOT, path), "utf8"));
  return parsed;
}

function workspaceFolders(rootPackage: PackageJson): Map<string, string> {
  const folders = new Map<string, string>();
  for (const pattern of rootPackage.workspaces?.packages ?? []) {
    const candidates = pattern.endsWith("/*")
      ? readdirSync(join(ROOT, pattern.slice(0, -2))).map((name) => `${pattern.slice(0, -2)}/${name}`)
      : [pattern];
    for (const folder of candidates) {
      if (!existsSync(join(ROOT, folder, "package.json"))) continue;
      const name = readJson<PackageJson>(`${folder}/package.json`).name;
      if (name) folders.set(name, folder);
    }
  }
  return folders;
}

/** The workspace folders that a package uses, directly or through another workspace package. */
function dependencyFolders(packageFolder: string, workspaces: Map<string, string>): string[] {
  const found = new Set<string>();
  const visit = (folder: string) => {
    const manifest = readJson<PackageJson>(posix.join(folder, "package.json"));
    for (const name of Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })) {
      const dependency = workspaces.get(name);
      if (dependency === undefined || found.has(dependency)) continue;
      found.add(dependency);
      visit(dependency);
    }
  };
  visit(packageFolder);
  return [...found];
}

/** The fixed part of each `include` pattern, such as `src/renderer` for `src/renderer/** /*.ts`. */
function includeRoots(tsconfigPath: string): string[] {
  const config = readJson<{ extends?: string; include?: string[] }>(tsconfigPath);
  if (config.include === undefined) {
    return config.extends?.startsWith(".") ? includeRoots(posix.join(posix.dirname(tsconfigPath), config.extends)) : [];
  }
  return config.include.map((pattern) => {
    const parts = pattern.split("/");
    const glob = parts.findIndex((part) => /[*?[{]/.test(part));
    const fixed = glob === -1 ? parts : parts.slice(0, glob);
    return relative(ROOT, resolve(ROOT, posix.dirname(tsconfigPath), ...fixed)) || ".";
  });
}

function projects(): Project[] {
  const rootPackage = readJson<PackageJson>("package.json");
  const workspaces = workspaceFolders(rootPackage);
  return Object.entries(rootPackage.scripts ?? {})
    .filter(([script]) => script.startsWith("typecheck:"))
    .map(([script, command]) => {
      const folder = command.match(/--cwd (\S+) typecheck$/)?.[1];
      const packageFolder = folder ?? ".";
      const tsconfig =
        folder === undefined
          ? command.match(/-p (\S+)/)?.[1]
          : posix.join(
              folder,
              readJson<PackageJson>(`${folder}/package.json`).scripts?.typecheck?.match(/-p (\S+)/)?.[1] ??
                "tsconfig.json",
            );
      if (tsconfig === undefined) return { script, roots: ["."] };
      return {
        script,
        roots: [
          ...includeRoots(tsconfig),
          ...(folder === undefined ? [] : [folder]),
          ...dependencyFolders(packageFolder, workspaces),
          ...(RELATIVE_IMPORTS[script] ?? []),
        ],
      };
    });
}

const contains = (root: string, path: string) => root === "." || path === root || path.startsWith(`${root}/`);

/** Each selected script, with the first staged path that selected it. */
function selectTypechecks(paths: string[]): Map<string, string> {
  const selected = new Map<string, string>();
  const all = projects();
  for (const path of paths) {
    for (const project of all) {
      if (selected.has(project.script)) continue;
      const mobileCodegen = project.script === "typecheck:mobile" && MOBILE_CODEGEN_INPUTS.includes(path);
      const visible = TYPE_INPUT.test(path) && project.roots.some((root) => contains(root, path));
      if (SELECTS_ALL.test(path) || mobileCodegen || visible) selected.set(project.script, path);
    }
  }
  // Keep the order of `package.json`.
  return new Map(
    all.filter(({ script }) => selected.has(script)).map(({ script }) => [script, selected.get(script) ?? ""]),
  );
}

function stagedPaths(): string[] {
  // Without renames, a moved file lists its old path too: the files that imported it now fail.
  const output = execFileSync("git", ["diff", "--cached", "--name-only", "--no-renames", "-z"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  return output.split("\0").filter(Boolean);
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const unknown = args.find((argument) => argument.startsWith("--") && argument !== "--dry-run");
  if (unknown) throw new Error(`Unknown option: ${unknown}. Use --dry-run.`);
  const given = args.filter((argument) => !argument.startsWith("--"));
  if (given.length > 0 && !dryRun) throw new Error("Paths are only for --dry-run; a commit checks the index.");

  const selection = selectTypechecks(given.length > 0 ? given : stagedPaths());
  if (selection.size === 0) {
    process.stdout.write("Skipping type checks: no staged file is in a TypeScript project.\n");
    process.exit(0);
  }
  const width = Math.max(...[...selection.keys()].map((script) => script.length));
  for (const [script, path] of selection) process.stdout.write(`${script.padEnd(width)}  ${path}\n`);
  if (dryRun) process.exit(0);

  const failed: string[] = [];
  for (const script of selection.keys()) {
    process.stdout.write(`\n$ bun run ${script}\n`);
    try {
      execFileSync("bun", ["run", script], { cwd: ROOT, stdio: "inherit" });
    } catch {
      failed.push(script);
    }
  }
  if (failed.length > 0) {
    process.stderr.write(`\nType checks failed: ${failed.join(", ")}\n`);
    process.exit(1);
  }
}
