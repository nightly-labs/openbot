import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { SKILL_DESCRIPTION_MAX_LENGTH, type SkillPackagePreview } from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Schema } from "effect";
import { strFromU8, unzipSync, type Zippable, zipSync } from "fflate";
import { parse as parseYaml } from "yaml";
import { causeHelpers } from "../backend/effect-boundary";

/** The YAML frontmatter at the start of a `SKILL.md`; group 1 is the YAML. */
export const SKILL_FRONTMATTER = /^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u;

export const MAX_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 200;
/** The file macOS Finder writes into each folder it opens. A package made from a folder leaves it out. */
export const FINDER_METADATA_FILE = ".DS_Store";
/** The mode that an archive entry gets when its file is executable: Unix (`os` 3), a regular file, `rwxr-xr-x`. */
const EXECUTABLE_ENTRY = { os: 3, attrs: 0o100755 * 0x10000 } as const;

/** Files for `zipSync`. Each name in `executable` keeps its execute bit in the archive (#7746). */
export function skillZippable(files: Record<string, Uint8Array>, executable: ReadonlySet<string>): Zippable {
  return Object.fromEntries(
    Object.entries(files).map(([name, bytes]) => [name, executable.has(name) ? [bytes, EXECUTABLE_ENTRY] : bytes]),
  );
}

export const archiveDirectory = Effect.fn("SkillPackage.archiveDirectory")(function* (root: string) {
  const files: Record<string, Uint8Array> = {};
  const executable = new Set<string>();
  let expandedSize = 0;
  function visit(directory: string): Effect.Effect<void, SkillArchiveFailure> {
    return Effect.gen(function* () {
      for (const entry of yield* archiveIO(() => readdir(directory, { withFileTypes: true }))) {
        if (entry.name === ".git" || entry.name === "node_modules" || entry.name === FINDER_METADATA_FILE) continue;
        const path = join(directory, entry.name);
        if (entry.isSymbolicLink())
          return yield* new SkillArchiveFailure({ cause: new Error(sourceText("error.skill.symlinks")) });
        if (entry.isDirectory()) yield* visit(path);
        else if (entry.isFile()) {
          const name = relative(root, path).replaceAll("\\", "/");
          const stats = yield* archiveIO(() => lstat(path));
          expandedSize += stats.size;
          if (stats.mode & 0o111) executable.add(name);
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
    try: () => zipSync(skillZippable(files, executable), { level: 6 }),
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
  const match = text.match(SKILL_FRONTMATTER);
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
  return readSkillArchive(bytes).files;
}

/** The files of a skill package, and the names of the files that the archive marks executable. */
export function readSkillArchive(bytes: Uint8Array): {
  files: Record<string, Uint8Array>;
  executable: Set<string>;
} {
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
  // `unzipSync` read the same headers without an error, so each offset here is in the archive.
  const executableEntries = executableArchiveEntries(bytes);
  const entries = Object.entries(raw).filter(([name]) => !name.endsWith("/"));
  if (!entries.length || entries.length > MAX_FILES) throw new Error(sourceText("error.skill.fileCountInvalid"));
  const roots = new Set(entries.map(([name]) => name.replaceAll("\\", "/").split("/")[0]));
  const wrapper = roots.size === 1 && entries.every(([name]) => name.includes("/")) ? [...roots][0] : null;
  const result: Record<string, Uint8Array> = {};
  const executable = new Set<string>();
  let size = 0;
  for (const [rawName, data] of entries) {
    const name = (wrapper ? rawName.slice((wrapper?.length ?? 0) + 1) : rawName).replaceAll("\\", "/");
    if (isUnsafeArchivePath(name)) throw new Error(sourceText("error.skill.unsafeFile", { name }));
    size += data.byteLength;
    if (size > MAX_BYTES) throw new Error(sourceText("error.skill.expandedTooLarge"));
    result[name] = data;
    if (executableEntries.has(rawName)) executable.add(name);
  }
  return { files: result, executable };
}

/**
 * The entry names that a Unix or macOS archive marks executable, as `agent-archive.ts` reads them.
 * `unzipSync` gives no file modes, so this reads the central directory as fflate does. Other bits,
 * such as setuid, are not kept.
 */
function executableArchiveEntries(bytes: Uint8Array): Set<string> {
  const u16 = (at: number) => (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8);
  const u32 = (at: number) => (u16(at) | (u16(at + 2) << 16)) >>> 0;
  const names = new Set<string>();
  let end = bytes.byteLength - 22;
  while (end > 0 && u32(end) !== 0x06054b50) end -= 1;
  let count = u16(end + 8);
  let offset = u32(end + 16);
  if (u32(end - 20) === 0x07064b50 && u32(u32(end - 12)) === 0x06064b50) {
    const zip64End = u32(end - 12);
    count = u32(zip64End + 32);
    offset = u32(zip64End + 48);
  }
  for (let index = 0; index < count && u32(offset) === 0x02014b50; index += 1) {
    const os = bytes[offset + 5];
    const nameLength = u16(offset + 28);
    const name = strFromU8(bytes.subarray(offset + 46, offset + 46 + nameLength), !(u16(offset + 8) & 0x800));
    if ((os === 3 || os === 19) && (u32(offset + 38) >>> 16) & 0o111) names.add(name);
    offset += 46 + nameLength + u16(offset + 30) + u16(offset + 32);
  }
  return names;
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
  if (value) return value;
  // A name with no Latin letter or digit, such as one in Japanese, gets a slug from its hash.
  const trimmed = name.trim();
  if (!trimmed) throw new Error(sourceText("error.skill.slugInvalid"));
  return `skill-${createHash("sha256").update(trimmed).digest("hex").slice(0, 12)}`;
}

export class SkillArchiveFailure extends Schema.TaggedError<SkillArchiveFailure>()("SkillArchiveFailure", {
  cause: Schema.Defect(),
}) {}

const { io: archiveIO } = causeHelpers(SkillArchiveFailure);
