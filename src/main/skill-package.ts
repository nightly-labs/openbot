import { lstat, readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { SKILL_DESCRIPTION_MAX_LENGTH, type SkillPackagePreview } from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Schema } from "effect";
import { unzipSync, zipSync } from "fflate";
import { parse as parseYaml } from "yaml";
import { causeHelpers } from "../backend/effect-boundary";

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 200;
export const archiveDirectory = Effect.fn("SkillPackage.archiveDirectory")(function* (root: string) {
  const files: Record<string, Uint8Array> = {};
  let expandedSize = 0;
  function visit(directory: string): Effect.Effect<void, SkillArchiveFailure> {
    return Effect.gen(function* () {
      for (const entry of yield* archiveIO(() => readdir(directory, { withFileTypes: true }))) {
        if (entry.name === ".git" || entry.name === "node_modules" || entry.name === ".DS_Store") continue;
        const path = join(directory, entry.name);
        if (entry.isSymbolicLink())
          return yield* new SkillArchiveFailure({ cause: new Error(sourceText("error.skill.symlinks")) });
        if (entry.isDirectory()) yield* visit(path);
        else if (entry.isFile()) {
          const name = relative(root, path).replaceAll("\\", "/");
          expandedSize += (yield* archiveIO(() => lstat(path))).size;
          if (expandedSize > MAX_BYTES)
            return yield* new SkillArchiveFailure({ cause: new Error(sourceText("error.skill.expandedTooLarge")) });
          files[name] = new Uint8Array(yield* archiveIO(() => readFile(path)));
          if (Object.keys(files).length > MAX_FILES)
            return yield* new SkillArchiveFailure({
              cause: new Error(sourceText("error.skill.tooManyFiles", { limit: MAX_FILES })),
            });
        } else return yield* new SkillArchiveFailure({ cause: new Error(sourceText("error.skill.irregularEntry")) });
      }
    });
  }
  yield* visit(root);
  const bytes = yield* Effect.try({
    try: () => zipSync(files, { level: 6 }),
    catch: (cause) => new SkillArchiveFailure({ cause }),
  });
  if (bytes.byteLength > MAX_BYTES)
    return yield* new SkillArchiveFailure({ cause: new Error(sourceText("error.skill.packageTooLarge")) });
  return bytes;
});

/** One `SKILL.md` on its own, as an agent template carries it; publish and install both read it here. */
export function inspectSkillMarkdown(markdown: string): Omit<SkillPackagePreview, "draftId" | "size"> {
  return inspectArchive(zipSync({ "SKILL.md": new TextEncoder().encode(markdown) }));
}

export function inspectArchive(bytes: Uint8Array): Omit<SkillPackagePreview, "draftId" | "size"> {
  const files = normalizedFiles(bytes);
  const skillFile = files["SKILL.md"];
  if (!skillFile) throw new Error(sourceText("error.skill.missingSkillFile"));
  const text = new TextDecoder("utf-8", { fatal: true }).decode(skillFile);
  const match = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u);
  if (!match) throw new Error(sourceText("error.skill.frontmatterMissing"));
  const metadata = parseYaml(match[1] ?? "");
  if (!isDynamicRecord(metadata)) throw new Error(sourceText("error.skill.metadataInvalid"));
  const name = isString(metadata.name) ? metadata.name.trim() : "";
  const description = isString(metadata.description) ? metadata.description.trim() : "";
  if (!name || name.length > 80 || !description || description.length > SKILL_DESCRIPTION_MAX_LENGTH)
    throw new Error(sourceText("error.skill.nameAndDescriptionRequired"));
  return { name, description, slug: slugify(name), files: Object.keys(files).sort() };
}

export function normalizedFiles(bytes: Uint8Array): Record<string, Uint8Array> {
  if (!bytes.byteLength || bytes.byteLength > MAX_BYTES) throw new Error(sourceText("error.skill.packageTooLarge"));
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
    throw new Error(sourceText("error.skill.zipInvalid"));
  }
  const entries = Object.entries(raw).filter(([name]) => !name.endsWith("/"));
  if (!entries.length || entries.length > MAX_FILES) throw new Error(sourceText("error.skill.fileCountInvalid"));
  const roots = new Set(entries.map(([name]) => name.replaceAll("\\", "/").split("/")[0]));
  const wrapper = roots.size === 1 && entries.every(([name]) => name.includes("/")) ? [...roots][0] : null;
  const result: Record<string, Uint8Array> = {};
  let size = 0;
  for (const [rawName, data] of entries) {
    const name = (wrapper ? rawName.slice((wrapper?.length ?? 0) + 1) : rawName).replaceAll("\\", "/");
    if (isUnsafeArchivePath(name)) throw new Error(sourceText("error.skill.unsafeFile", { name }));
    size += data.byteLength;
    if (size > MAX_BYTES) throw new Error(sourceText("error.skill.expandedTooLarge"));
    result[name] = data;
  }
  return result;
}

/** A path that escapes its folder, or a file that must not travel: secrets, VCS data, nested archives. */
export function isUnsafeArchivePath(name: string): boolean {
  const parts = name.split("/");
  const file = parts.at(-1)?.toLowerCase() ?? "";
  return (
    !name ||
    name.startsWith("/") ||
    parts.some((part) => !part || part === "." || part === "..") ||
    parts.includes(".git") ||
    parts.includes("node_modules") ||
    file.startsWith(".env") ||
    /private.*key/iu.test(file) ||
    /\.(?:zip|tar|tgz|gz|7z|rar)$/iu.test(file)
  );
}

function slugify(name: string): string {
  const value = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 64);
  if (!value) throw new Error(sourceText("error.skill.slugInvalid"));
  return value;
}

export class SkillArchiveFailure extends Schema.TaggedError<SkillArchiveFailure>()("SkillArchiveFailure", {
  cause: Schema.Defect(),
}) {}

const { io: archiveIO } = causeHelpers(SkillArchiveFailure);
