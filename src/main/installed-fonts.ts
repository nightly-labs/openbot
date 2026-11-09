import { type Dirent, promises as fs } from "node:fs";
import { homedir } from "node:os";
import { extname, join } from "node:path";
import { createOpenBotLogger } from "@openbot/logging";

const logger = createOpenBotLogger("installed-fonts");

/** The font file types that carry a family name in an sfnt name table. */
const FONT_EXTENSIONS = new Set([".ttf", ".otf", ".ttc", ".otc"]);
/** A scan stops here. A folder with more files than this is not a font folder. */
const MAX_FONT_FILES = 5_000;
/** A font collection holds a few faces. More than this in one file is a corrupt table. */
const MAX_FACES = 64;
/** A name table is small. A table above this size is corrupt, and its first part is enough. */
const MAX_NAME_TABLE_BYTES = 1_024 * 1_024;
/** The family names change only when a font is installed, so one scan answers many openings. */
const CACHE_TTL_MS = 5 * 60_000;

/** A font file that the parser reads at offsets, so a large collection is never read whole. */
interface FontSource {
  size: number;
  read(offset: number, length: number): Promise<Buffer>;
}

/**
 * The family names of one font file: the typographic family of each face, else its family, with the
 * English name first. A file with no name table, or with a table this cannot read, gives no name.
 */
export async function fontFamilies(source: FontSource): Promise<string[]> {
  let header: Buffer;
  try {
    header = await source.read(0, 12);
  } catch {
    return [];
  }
  if (header.length < 12) return [];
  const tag = header.toString("latin1", 0, 4);
  const faceOffsets: number[] = [];
  if (tag === "ttcf") {
    const count = Math.min(header.readUInt32BE(8), MAX_FACES);
    if (count === 0) return [];
    const offsets = await source.read(12, count * 4).catch(() => Buffer.alloc(0));
    for (let offset = 0; offset + 4 <= offsets.length; offset += 4) faceOffsets.push(offsets.readUInt32BE(offset));
  } else if (tag === "\u0000\u0001\u0000\u0000" || tag === "OTTO" || tag === "true" || tag === "typ1") {
    faceOffsets.push(0);
  } else {
    return [];
  }
  const names = new Set<string>();
  for (const offset of faceOffsets) {
    const name = await faceFamily(source, offset).catch(() => null);
    if (name !== null) names.add(name);
  }
  return [...names];
}

interface NameCandidate {
  name: string;
  nameId: number;
  languageId: number;
  unicode: boolean;
}

async function faceFamily(source: FontSource, faceOffset: number): Promise<string | null> {
  const header = await source.read(faceOffset, 12);
  if (header.length < 12) return null;
  const tableCount = Math.min(header.readUInt16BE(4), 256);
  const records = await source.read(faceOffset + 12, tableCount * 16);
  for (let record = 0; record + 16 <= records.length; record += 16) {
    if (records.toString("latin1", record, record + 4) !== "name") continue;
    const offset = records.readUInt32BE(record + 8);
    const length = Math.min(records.readUInt32BE(record + 12), MAX_NAME_TABLE_BYTES);
    const table = await source.read(offset, length);
    return familyFromNameTable(table);
  }
  return null;
}

function familyFromNameTable(table: Buffer): string | null {
  if (table.length < 6) return null;
  const count = table.readUInt16BE(2);
  const storage = table.readUInt16BE(4);
  const candidates: NameCandidate[] = [];
  for (let index = 0; index < count; index += 1) {
    const record = 6 + index * 12;
    if (record + 12 > table.length) break;
    const platformId = table.readUInt16BE(record);
    const languageId = table.readUInt16BE(record + 4);
    const nameId = table.readUInt16BE(record + 6);
    if (nameId !== 1 && nameId !== 16) continue;
    const length = table.readUInt16BE(record + 8);
    const offset = storage + table.readUInt16BE(record + 10);
    if (offset + length > table.length) continue;
    const unicode = platformId === 0 || platformId === 3;
    const bytes = table.subarray(offset, offset + length);
    const name = cleanFamily(unicode ? decodeUtf16Be(bytes) : bytes.toString("latin1"));
    if (name !== null) candidates.push({ name, nameId, languageId, unicode });
  }
  if (candidates.length === 0) return null;
  // The typographic family is the name that a font menu shows; the English name reads best here.
  const score = (candidate: NameCandidate) =>
    (candidate.nameId === 16 ? 4 : 0) + (candidate.languageId === 0x0409 ? 2 : 0) + (candidate.unicode ? 1 : 0);
  return candidates.reduce((best, candidate) => (score(candidate) > score(best) ? candidate : best)).name;
}

/** A family name as the Settings list shows it, or null when the bytes are not a name. */
function decodeUtf16Be(bytes: Buffer): string {
  let text = "";
  for (let offset = 0; offset + 1 < bytes.length; offset += 2) text += String.fromCharCode(bytes.readUInt16BE(offset));
  return text;
}

function cleanFamily(value: string): string | null {
  const name = [...value]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code > 0x1f && code !== 0x7f;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  if (name.length === 0 || name.length > 64) return null;
  // A leading dot names a hidden system face. The font menu does not offer it.
  if (name.startsWith(".")) return null;
  return name;
}

/** The folders that hold installed fonts on this platform, the user's own fonts included. */
export function fontDirectories(platform: NodeJS.Platform = process.platform, home = homedir()): string[] {
  switch (platform) {
    case "darwin":
      return [
        "/System/Library/Fonts",
        "/System/Library/Fonts/Supplemental",
        "/Library/Fonts",
        join(home, "Library/Fonts"),
      ];
    case "win32":
      return [
        join(process.env.WINDIR ?? "C:\\Windows", "Fonts"),
        join(process.env.LOCALAPPDATA ?? join(home, "AppData", "Local"), "Microsoft", "Windows", "Fonts"),
      ];
    case "linux":
      return ["/usr/share/fonts", "/usr/local/share/fonts", join(home, ".local/share/fonts"), join(home, ".fonts")];
    default:
      return [];
  }
}

async function fontFilesIn(directory: string, depth: number, files: string[], seen: Set<string>): Promise<void> {
  if (depth > 4 || files.length >= MAX_FONT_FILES) return;
  let entries: Dirent[];
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (files.length >= MAX_FONT_FILES) return;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!seen.has(path)) {
        seen.add(path);
        await fontFilesIn(path, depth + 1, files, seen);
      }
    } else if (entry.isFile() && FONT_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      files.push(path);
    }
  }
}

async function familiesOfFile(path: string): Promise<string[]> {
  const file = await fs.open(path, "r").catch(() => undefined);
  if (file === undefined) return [];
  try {
    const { size } = await file.stat();
    if (size === 0) return [];
    return await fontFamilies({
      size,
      read: async (offset, length) => {
        const start = Math.min(offset, size);
        const buffer = Buffer.alloc(Math.min(length, size - start));
        const { bytesRead } = await file.read(buffer, 0, buffer.length, start);
        return buffer.subarray(0, bytesRead);
      },
    });
  } catch {
    return [];
  } finally {
    await file.close().catch(() => undefined);
  }
}

async function scanInstalledFontFamilies(): Promise<string[]> {
  const files: string[] = [];
  const seen = new Set<string>();
  for (const directory of fontDirectories()) await fontFilesIn(directory, 0, files, seen);
  const families = new Map<string, string>();
  // A few files at a time: a font folder holds hundreds, and one handle each would hit the limit.
  for (let start = 0; start < files.length; start += 8) {
    const batch = files.slice(start, start + 8);
    const names = await Promise.all(batch.map((path) => familiesOfFile(path)));
    for (const name of names.flat()) {
      const key = name.toLocaleLowerCase("en");
      if (!families.has(key)) families.set(key, name);
    }
  }
  return [...families.values()].sort((left, right) => left.localeCompare(right, "en"));
}

let cached: { at: number; families: Promise<string[]> } | null = null;

/** The family names of the fonts installed on this computer, for the Settings picker. */
export function listInstalledFontFamilies(): Promise<string[]> {
  if (cached !== null && Date.now() - cached.at < CACHE_TTL_MS) return cached.families;
  const families = scanInstalledFontFamilies().catch((error: unknown) => {
    logger.warn("Could not read the installed fonts:", error);
    return [];
  });
  cached = { at: Date.now(), families };
  return families;
}
