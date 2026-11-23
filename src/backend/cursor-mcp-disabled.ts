import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, parse, resolve } from "node:path";
import { isMissingFileError } from "./file-errors";
import { cursorDataHome } from "./process-confinement";

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

function cursorProjectSlug(path: string): string {
  return path
    .replace(/[^a-zA-Z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}
