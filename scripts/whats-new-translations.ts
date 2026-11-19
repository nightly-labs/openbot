import { readFileSync } from "node:fs";
import { TRANSLATED_LOCALES } from "../packages/i18n/src/locale";

const NOTES_DIR = "src/renderer/src/features/updates";
export const ENGLISH_FILE = `${NOTES_DIR}/whats-new-releases.json`;
const translationFile = (locale: string) => `${NOTES_DIR}/whats-new/${locale}.json`;
const GROUP_TYPES = ["added", "changed", "fixed"];

interface Release {
  version: string;
  date: string;
  notices: string[];
  groups: { type: string; items: string[] }[];
}

const isTextList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim() !== "");

function isGroup(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const { type, items }: { type?: unknown; items?: unknown } = value;
  return typeof type === "string" && GROUP_TYPES.includes(type) && isTextList(items);
}

function isRelease(value: unknown): value is Release {
  if (typeof value !== "object" || value === null) return false;
  const { version, date, notices, groups }: { version?: unknown; date?: unknown; notices?: unknown; groups?: unknown } =
    value;
  return (
    typeof version === "string" &&
    /^\d+\.\d+\.\d+$/.test(version) &&
    typeof date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    isTextList(notices) &&
    Array.isArray(groups) &&
    groups.every(isGroup)
  );
}

function readReleases(file: string): Release[] | string {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    return `${file} cannot be read: ${error instanceof Error ? error.message : String(error)}`;
  }
  if (!Array.isArray(value)) return `${file} is not a list of releases`;
  const wrong = value.findIndex((release) => !isRelease(release));
  if (wrong >= 0) return `${file}: release ${wrong + 1} has no valid version, date, notices or groups`;
  return value.filter(isRelease);
}

const shape = (release: Release) =>
  [release.notices.length, ...release.groups.map((group) => `${group.type}:${group.items.length}`)].join(" ");

export function whatsNewTranslationProblems(version?: string): string[] {
  const english = readReleases(ENGLISH_FILE);
  if (typeof english === "string") return [english];
  const englishByVersion = new Map(english.map((release) => [release.version, release]));
  const problems: string[] = [];
  for (const locale of TRANSLATED_LOCALES) {
    if (locale === "en") continue;
    const file = translationFile(locale);
    const releases = readReleases(file);
    if (typeof releases === "string") {
      problems.push(releases);
      continue;
    }
    const seen = new Set<string>();
    for (const release of releases) {
      const source = englishByVersion.get(release.version);
      if (seen.has(release.version)) problems.push(`${file}: ${release.version} appears two times`);
      seen.add(release.version);
      if (!source) {
        problems.push(`${file}: ${release.version} is not in ${ENGLISH_FILE}`);
      } else if (release.date !== source.date) {
        problems.push(`${file}: ${release.version} has the date ${release.date}, not ${source.date}`);
      } else if (shape(release) !== shape(source)) {
        problems.push(`${file}: ${release.version} has notices and items "${shape(release)}", not "${shape(source)}"`);
      }
    }
    if (version && englishByVersion.has(version) && !seen.has(version)) {
      problems.push(`${file} does not translate ${version}`);
    }
  }
  return problems;
}

if (import.meta.main) {
  const problems = whatsNewTranslationProblems(process.argv[2]);
  for (const problem of problems) process.stderr.write(`${problem}\n`);
  if (problems.length > 0) {
    process.stderr.write("See docs/RELEASING.md#post-update-notes.\n");
    process.exit(1);
  }
}
