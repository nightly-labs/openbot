import { lstat, readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type { SkillPackagePreview } from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { unzipSync, zipSync } from "fflate";
import { parse as parseYaml } from "yaml";

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 200;
export async function archiveDirectory(root: string): Promise<Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  let expandedSize = 0;
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === ".git" || entry.name === "node_modules" || entry.name === ".DS_Store") continue;
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error("Skill packages cannot contain symbolic links.");
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) {
        const name = relative(root, path).replaceAll("\\", "/");
        expandedSize += (await lstat(path)).size;
        if (expandedSize > MAX_BYTES) throw new Error("The expanded skill must be under 10 MB.");
        files[name] = new Uint8Array(await readFile(path));
        if (Object.keys(files).length > MAX_FILES) throw new Error(`A skill can contain at most ${MAX_FILES} files.`);
      } else throw new Error("Skill packages can contain only regular files and folders.");
    }
  }
  await visit(root);
  const bytes = zipSync(files, { level: 6 });
  if (bytes.byteLength > MAX_BYTES) throw new Error("The skill package must be under 10 MB.");
  return bytes;
}

export function inspectArchive(bytes: Uint8Array): Omit<SkillPackagePreview, "draftId" | "size"> {
  const files = normalizedFiles(bytes);
  const skillFile = files["SKILL.md"];
  if (!skillFile) throw new Error("The skill package must contain SKILL.md at its root.");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(skillFile);
  const match = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u);
  if (!match) throw new Error("SKILL.md must begin with YAML frontmatter.");
  const metadata = parseYaml(match[1] ?? "");
  if (!isDynamicRecord(metadata)) throw new Error("SKILL.md metadata is invalid.");
  const name = isString(metadata.name) ? metadata.name.trim() : "";
  const description = isString(metadata.description) ? metadata.description.trim() : "";
  if (!name || name.length > 80 || !description || description.length > 500)
    throw new Error("SKILL.md needs a valid name and description.");
  return { name, description, slug: slugify(name), files: Object.keys(files).sort() };
}

export function normalizedFiles(bytes: Uint8Array): Record<string, Uint8Array> {
  if (!bytes.byteLength || bytes.byteLength > MAX_BYTES) throw new Error("The skill package must be under 10 MB.");
  let raw: Record<string, Uint8Array>;
  try {
    let expandedSize = 0;
    let fileCount = 0;
    raw = unzipSync(bytes, {
      filter: (file) => {
        fileCount += 1;
        expandedSize += file.originalSize;
        if (fileCount > MAX_FILES || expandedSize > MAX_BYTES) throw new Error("Archive limits exceeded.");
        return true;
      },
    });
  } catch {
    throw new Error("The selected ZIP is invalid.");
  }
  const entries = Object.entries(raw).filter(([name]) => !name.endsWith("/"));
  if (!entries.length || entries.length > MAX_FILES)
    throw new Error("The skill package has an invalid number of files.");
  const roots = new Set(entries.map(([name]) => name.replaceAll("\\", "/").split("/")[0]));
  const wrapper = roots.size === 1 && entries.every(([name]) => name.includes("/")) ? [...roots][0] : null;
  const result: Record<string, Uint8Array> = {};
  let size = 0;
  for (const [rawName, data] of entries) {
    const name = (wrapper ? rawName.slice((wrapper?.length ?? 0) + 1) : rawName).replaceAll("\\", "/");
    const parts = name.split("/");
    const file = parts.at(-1)?.toLowerCase() ?? "";
    if (
      !name ||
      name.startsWith("/") ||
      parts.some((part) => !part || part === "." || part === "..") ||
      parts.includes(".git") ||
      parts.includes("node_modules") ||
      file.startsWith(".env") ||
      /private.*key/iu.test(file) ||
      /\.(?:zip|tar|tgz|gz|7z|rar)$/iu.test(file)
    ) {
      throw new Error(`The skill package contains an unsafe file: ${name}`);
    }
    size += data.byteLength;
    if (size > MAX_BYTES) throw new Error("The expanded skill must be under 10 MB.");
    result[name] = data;
  }
  return result;
}

function slugify(name: string): string {
  const value = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 64);
  if (!value) throw new Error("The skill name cannot form a valid slug.");
  return value;
}
