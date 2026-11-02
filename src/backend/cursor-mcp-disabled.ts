import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, parse, resolve } from "node:path";
import { isMissingFileError } from "./file-errors";
import { cursorDataHome } from "./process-confinement";

/**
 * Cursor 2026.10.22-27dcf5f does not load a server whose name is in the project's
 * `mcp-disabled.json`, also a server that an ACP session gives it, and does not report it (#3058).
 * The list has names only, so an `openbot` entry from the user's own Cursor CLI takes OpenBot's
 * tools from each agent in that project. This removes OpenBot's names and keeps the other entries.
 */
export function enableCursorMcpServers(cwd: string, names: readonly string[]): void {
  const file = join(cursorDataHome(), "projects", cursorProjectSlug(cursorProjectRoot(cwd)), "mcp-disabled.json");
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) return;
    throw error;
  }
  const disabled = JSON.parse(text);
  if (!Array.isArray(disabled)) return;
  const kept = disabled.filter((name) => !names.includes(name));
  if (kept.length !== disabled.length) writeFileSync(file, JSON.stringify(kept, null, 2));
}

/** Cursor's project: the nearest folder of the workspace that has `.git`, up to below the root, or the workspace. */
function cursorProjectRoot(cwd: string): string {
  const start = resolve(cwd);
  const { root } = parse(start);
  let folder = start;
  while (true) {
    if (existsSync(join(folder, ".git"))) return folder;
    const parent = dirname(folder);
    if (parent === folder || parent === root) return start;
    folder = parent;
  }
}

/** The folder name that Cursor gives a project in `projects`. */
function cursorProjectSlug(path: string): string {
  return path
    .replace(/[^a-zA-Z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}
