// Which CI areas a change can reach. The `changes` job in
// `.github/workflows/ci.yml` pipes the changed paths in, one per line, and
// appends the `area=true|false` lines this prints to `$GITHUB_OUTPUT`; every
// other job runs only when its area is `true`.
//
// Package edges come from the workspace manifests, so a new `workspace:`
// dependency moves the map with it. The rules below cover what the manifests
// cannot say. Anything they do not recognise turns every area on: a missed job
// is a regression shipped, an extra job is only a minute of runner time.
//
// This runs from a sparse checkout with no `bun install`, so it may import only
// `node:*` and files reached by relative path.

import { workspaceClosure, workspaceDependencies, workspaceDirectories } from "./workspace-graph";

export const AREAS = ["desktop", "mobile", "api", "sites", "remote", "storybook", "unit", "code"] as const;
export type Area = (typeof AREAS)[number];
export type AffectedAreas = Readonly<Record<Area, boolean>>;

// Every area but `code`, which only says whether anything other than prose changed.
const CHECK_AREAS: readonly Area[] = AREAS.filter((area) => area !== "code");

// Paths no check reads.
const SKIPPED: readonly RegExp[] = [
  /^[^/]+\.md$/,
  /(^|\/)(AGENTS|CLAUDE|README)\.md$/,
  /^docs\//,
  /^plans\//,
  /^\.github\/(ISSUE_TEMPLATE|issue-assets)\//,
  /^\.(claude|codex|vscode)\//,
  /^\.(editorconfig|worktreeinclude)$/,
];

// Inputs every job reads: CI itself, the install, the toolchain and the shared lint config.
const GLOBAL: readonly RegExp[] = [
  /^\.github\//,
  /(^|\/)package\.json$/,
  /^(bun\.lock|bunfig\.toml|\.nvmrc|biome\.json|vitest\.config\.ts)$/,
  /^tsconfig[^/]*\.json$/,
  /^tools\/(vitest|biome)\//,
];

// Edges the manifests do not declare, checked before the workspace match.
const EXTRA_EDGES: readonly (readonly [RegExp, readonly Area[]])[] = [
  // `apps/auth-api` builds `src/renderer/src/preview/OpenBotPlayground.tsx`
  // through the `@openbot/renderer-preview` alias, and Storybook builds the renderer.
  [/^src\/renderer\//, ["desktop", "unit", "storybook", "api"]],
  [/^\.storybook\//, ["desktop", "storybook"]],
  // `scripts/dependency-catalog.test.ts` checks this file against the workspace graph.
  [/^remote\/api\/Dockerfile$/, ["remote", "unit"]],
];

// Root-owned paths outside any workspace: the desktop app, its build inputs, and
// the scripts and tools whose tests run in the root suite.
const ROOT_OWNED: readonly RegExp[] = [
  /^(src|scripts|tools|resources|build|marketplace|patches|vendor|\.agents|\.githooks)\//,
  /^(electron-builder\.yml|electron\.vite\.config\.ts|native-runtime\.lock\.json|skills-lock\.json)$/,
];
const ROOT_AREAS: readonly Area[] = ["desktop", "unit", "storybook"];
const ROOT_OWNED_AREAS: readonly Area[] = ["desktop", "unit"];

// `remote/` outside the `remote/api` workspace: Compose files, which
// `remote:check:compose` validates, and `remote/scripts`, which
// `remote/api/tsconfig.json` includes.
const REMOTE_OWNED = /^remote\//;

// What runs when a workspace, or a package it reaches, changes. The root suite
// (`unit`) collects the mobile and `packages/*` tests.
const APP_AREAS: Readonly<Record<string, readonly Area[]>> = {
  "apps/mobile": ["mobile", "unit"],
  "apps/auth-api": ["api"],
  "apps/site-router": ["sites"],
  "remote/api": ["remote"],
};

export function workspaceAreas(directory: string): readonly Area[] | undefined {
  if (directory in APP_AREAS) return APP_AREAS[directory];
  if (directory.startsWith("packages/")) return ["unit"];
  return undefined;
}

export function affectedAreas(files: readonly string[]): AffectedAreas {
  const directoryOf = workspaceDirectories();
  const consumers = [
    { areas: ROOT_AREAS, reaches: workspaceClosure(workspaceDependencies("package.json")) },
    ...[...directoryOf].map(([name, directory]) => ({
      areas: workspaceAreas(directory) ?? CHECK_AREAS,
      reaches: workspaceClosure([name]),
    })),
  ];
  const workspaceByDirectory = [...directoryOf].sort(([, a], [, b]) => b.length - a.length);

  const flagged = new Set<Area>();
  for (const file of files) {
    if (file === "" || SKIPPED.some((pattern) => pattern.test(file))) continue;
    flagged.add("code");
    for (const area of areasFor(file)) flagged.add(area);
  }
  return {
    desktop: flagged.has("desktop"),
    mobile: flagged.has("mobile"),
    api: flagged.has("api"),
    sites: flagged.has("sites"),
    remote: flagged.has("remote"),
    storybook: flagged.has("storybook"),
    unit: flagged.has("unit"),
    code: flagged.has("code"),
  };

  function areasFor(file: string): readonly Area[] {
    if (GLOBAL.some((pattern) => pattern.test(file))) return CHECK_AREAS;
    const edge = EXTRA_EDGES.find(([pattern]) => pattern.test(file));
    if (edge) return edge[1];
    const workspace = workspaceByDirectory.find(([, directory]) => file.startsWith(`${directory}/`));
    if (workspace) {
      const [name] = workspace;
      return consumers.filter((consumer) => consumer.reaches.has(name)).flatMap((consumer) => consumer.areas);
    }
    if (ROOT_OWNED.some((pattern) => pattern.test(file))) return ROOT_OWNED_AREAS;
    if (REMOTE_OWNED.test(file)) return ["remote"];
    return CHECK_AREAS;
  }
}

async function printAffectedAreas(): Promise<void> {
  let input = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) input += String(chunk);
  const areas = affectedAreas(input.split("\n").map((line) => line.trim()));
  for (const area of AREAS) process.stdout.write(`${area}=${areas[area]}\n`);
}

if (import.meta.main) await printAffectedAreas();
