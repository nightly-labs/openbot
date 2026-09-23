// The workspace graph as the manifests declare it. `dependency-catalog.test.ts`
// reads it to keep the catalog and the remote API image honest, and
// `ci-affected-areas.ts` reads it to decide which CI jobs a change reaches.
//
// The contracts import is relative on purpose: CI's change-detection job runs
// this file from a sparse checkout with no `bun install`, so the
// `@openbot/contracts` workspace link does not exist there.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { DynamicRecord } from "../packages/contracts/src/runtime-values";
import { isDynamicRecord, isString } from "../packages/contracts/src/runtime-values";

export const repositoryRoot = resolve(import.meta.dirname, "..");

const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];

export function readManifest(path: string): DynamicRecord {
  const parsed = JSON.parse(readFileSync(join(repositoryRoot, path), "utf8"));
  if (!isDynamicRecord(parsed)) throw new Error(`${path} is not an object.`);
  return parsed;
}

// Expands the workspace globs the root manifest declares, so a workspace added
// later is covered without editing a caller.
export function readWorkspaces(manifest: DynamicRecord): readonly string[] {
  const workspaces = manifest.workspaces;
  if (!isDynamicRecord(workspaces)) throw new Error("Expected the object form of workspaces, with a catalog.");
  const patterns = workspaces.packages;
  if (!Array.isArray(patterns)) throw new Error("Expected workspaces.packages to be an array of globs.");

  const directories: string[] = [];
  for (const pattern of patterns) {
    if (!isString(pattern)) throw new Error("Expected every workspace glob to be a string.");
    if (!pattern.endsWith("/*")) {
      directories.push(pattern);
      continue;
    }
    const parent = pattern.slice(0, -2);
    for (const entry of readdirSync(join(repositoryRoot, parent), { withFileTypes: true })) {
      if (entry.isDirectory() && existsSync(join(repositoryRoot, parent, entry.name, "package.json"))) {
        directories.push(`${parent}/${entry.name}`);
      }
    }
  }
  return directories.sort();
}

export function readDependencies(path: string): readonly (readonly [string, string, string])[] {
  const manifest = readManifest(path);
  const declared: (readonly [string, string, string])[] = [];
  for (const field of DEPENDENCY_FIELDS) {
    const block = manifest[field];
    if (!isDynamicRecord(block)) continue;
    for (const [name, version] of Object.entries(block)) {
      if (!isString(version)) throw new Error(`Expected a version string for ${field}.${name} in ${path}.`);
      declared.push([field, name, version]);
    }
  }
  return declared;
}

// Every field, not just `dependencies`, even though the remote image installs
// with `--production`. Today every workspace edge in the repo is a plain
// dependency, so the difference is inert; the bias is deliberate for when it
// stops being. Naming a workspace a caller turns out not to need costs one
// harmless COPY line or one extra CI job, and missing one costs the image or a
// check that should have run.
export function workspaceDependencies(manifest: string): string[] {
  return readDependencies(manifest)
    .filter(([, , version]) => version.startsWith("workspace:"))
    .map(([, name]) => name);
}

// Package name to workspace directory, for every workspace the root declares.
export function workspaceDirectories(): ReadonlyMap<string, string> {
  return new Map(
    readWorkspaces(readManifest("package.json")).map((directory) => {
      const name = readManifest(`${directory}/package.json`).name;
      if (!isString(name)) throw new Error(`${directory}/package.json has no name.`);
      return [name, directory];
    }),
  );
}

// The named packages plus every workspace package they reach, directly or
// through another workspace.
export function workspaceClosure(names: readonly string[]): ReadonlySet<string> {
  const directoryOf = workspaceDirectories();
  const reached = new Set<string>();
  const pending = [...names];
  while (pending.length > 0) {
    const name = pending.pop();
    if (name === undefined || reached.has(name)) continue;
    reached.add(name);
    const directory = directoryOf.get(name);
    if (directory !== undefined) pending.push(...workspaceDependencies(`${directory}/package.json`));
  }
  return reached;
}
