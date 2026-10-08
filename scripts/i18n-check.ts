import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import type { Message, PluralMessage } from "@openbot/i18n";
import { TRANSLATED_LOCALES } from "@openbot/i18n";
import { matchingSourceKeys } from "@openbot/i18n/source";
import { createOpenBotLogger } from "@openbot/logging";

// Checks the catalogs in packages/i18n/src/messages. See docs/i18n.md.
//
// Fails on:
// - a key that does not start with its module's prefix, or a key in two modules;
// - a French or Japanese key that English does not have, a placeholder English does not have, or
//   a string where English has plural forms (and the reverse);
// - a source template that more than one source key can match, so the reverse lookup is ambiguous;
// - an English key no code names. Write keys as literals, so this check and a search find them.
//
// Reports, and does not fail on, keys that are not translated yet and translated modules whose keys
// are not in the English order. `--fix` puts those keys in the English order; it moves each
// key with the comments and blank lines above it and does not change the text. `--json` writes the
// report to .openbot-build/i18n-report.json.

const ROOT = resolve(import.meta.dirname, "..");
const MESSAGES = resolve(ROOT, "packages/i18n/src/messages");
/** Files that spread area modules together. They hold no keys of their own. */
const AGGREGATORS = new Set(["index", "mobile", "source", "shared"]);
/** Where code that names a key lives. The catalogs themselves are left out. */
const CODE_ROOTS = ["src", "packages", "apps/mobile/src", "apps/auth-api/src", "scripts"];
const CODE_EXTENSIONS = /\.(?:ts|tsx)$/;
const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", "build", "out", ".expo"]);

const logger = createOpenBotLogger("i18n-check");
const failures: string[] = [];
const OBJECT_START = "export const messages = {";
/** The quoted key of a catalog entry, after the comments and blank lines above it. */
const LEADING_KEY = /^(?:\s|\/\/[^\n]*)*"([^"\\]+)"\s*:/;

function files(directory: string, match: RegExp): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return SKIPPED_DIRECTORIES.has(entry.name) ? [] : files(path, match);
    return match.test(entry.name) ? [path] : [];
  });
}

/** `mobile/settings` for messages/en/mobile/settings.ts. */
function moduleName(locale: string, path: string): string {
  return relative(resolve(MESSAGES, locale), path).replaceAll(sep, "/").replace(/\.ts$/, "");
}

function isMessage(value: unknown): value is Message {
  if (typeof value === "string") return true;
  return isDynamicRecord(value) && Object.values(value).every((form) => typeof form === "string");
}

async function loadModule(path: string): Promise<Record<string, Message>> {
  const module = await import(path);
  if (!isDynamicRecord(module) || !isDynamicRecord(module.messages)) {
    throw new Error(`${relative(ROOT, path)} does not export \`messages\`.`);
  }
  const messages: Record<string, Message> = {};
  for (const [key, value] of Object.entries(module.messages)) {
    if (isMessage(value)) messages[key] = value;
    else failures.push(`${relative(ROOT, path)}: ${key} is neither text nor plural forms.`);
  }
  return messages;
}

function forms(message: Message): string[] {
  if (typeof message === "string") return [message];
  const plural: PluralMessage = message;
  return [plural.zero, plural.one, plural.two, plural.few, plural.many, plural.other].filter(
    (form): form is string => typeof form === "string",
  );
}

function placeholders(message: Message): Set<string> {
  return new Set(forms(message).flatMap((form) => [...form.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? "")));
}

/** The index after the string literal that starts at `start`. */
function stringEnd(text: string, start: number): number {
  const quote = text[start];
  for (let index = start + 1; index < text.length; index += 1) {
    if (text[index] === "\\") index += 1;
    else if (quote === "`" && text.startsWith("${", index))
      throw new Error("a template literal with a placeholder is not supported.");
    else if (text[index] === quote) return index + 1;
  }
  throw new Error("a string literal does not end.");
}

/**
 * Splits the `messages` object at its top-level commas. Each entry keeps the comments and blank
 * lines above its key, so they move with it.
 */
function catalogEntries(text: string): { head: string; entries: string[]; tail: string } {
  const open = text.indexOf(OBJECT_START);
  if (open < 0 || text.indexOf(OBJECT_START, open + 1) >= 0) throw new Error(`expected one \`${OBJECT_START}\`.`);
  const bodyStart = open + OBJECT_START.length;
  const entries: string[] = [];
  let depth = 0;
  let entryStart = bodyStart;
  for (let index = bodyStart; index < text.length; index += 1) {
    const char = text[index];
    if (text.startsWith("//", index)) {
      const lineEnd = text.indexOf("\n", index);
      index = (lineEnd < 0 ? text.length : lineEnd) - 1;
    } else if (text.startsWith("/*", index)) {
      throw new Error("a block comment is not supported; use a line comment above the key.");
    } else if (char === '"' || char === "'" || char === "`") {
      index = stringEnd(text, index) - 1;
    } else if (char === "{" || char === "[" || char === "(") {
      depth += 1;
    } else if (char === "}" || char === "]" || char === ")") {
      if (depth > 0) {
        depth -= 1;
        continue;
      }
      const last = text.slice(entryStart, index);
      const lastEntry = last.trimEnd();
      if (lastEntry.trim() === "") return { head: text.slice(0, bodyStart), entries, tail: text.slice(entryStart) };
      entries.push(lastEntry);
      return { head: text.slice(0, bodyStart), entries, tail: text.slice(entryStart + lastEntry.length) };
    } else if (char === "," && depth === 0) {
      entries.push(text.slice(entryStart, index));
      entryStart = index + 1;
    }
  }
  throw new Error("the `messages` object does not end.");
}

function entryKey(entry: string): string {
  if (!entry.startsWith("\n")) throw new Error("text follows a comma on the same line; put each key on its own line.");
  const key = LEADING_KEY.exec(entry)?.[1];
  if (key === undefined) throw new Error(`an entry does not start with a quoted key: ${entry.trim().slice(0, 60)}`);
  return key;
}

/** Puts the keys of a translated module in `order`. Keys that English does not have go last. */
function sortCatalog(text: string, order: readonly string[]): string {
  const { head, entries, tail } = catalogEntries(text);
  const rank = new Map(order.map((key, index) => [key, index]));
  const sorted = entries
    .map((entry, index) => ({ entry, rank: rank.get(entryKey(entry)) ?? order.length + index }))
    .sort((left, right) => left.rank - right.rank)
    .map(({ entry }) => entry);
  // A blank line separates groups; the first key in the object has none above it.
  const [first, ...rest] = sorted;
  if (first === undefined) return text;
  return `${head}${[first.replace(/^\n(?:[ \t]*\n)+/, "\n"), ...rest].join(",")},${tail}`;
}

function isInOrder(keys: readonly string[], order: readonly string[]): boolean {
  const known = new Set(keys);
  const expected = order.filter((key) => known.has(key));
  return expected.every((key, index) => keys[index] === key);
}

function modulePaths(locale: string): Map<string, string> {
  return new Map(
    files(resolve(MESSAGES, locale), /\.ts$/)
      .map((path) => [moduleName(locale, path), path] as const)
      .filter(([name]) => !AGGREGATORS.has(name)),
  );
}

const english = new Map<string, Record<string, Message>>();
const owner = new Map<string, string>();
for (const [name, path] of modulePaths("en")) {
  const messages = await loadModule(path);
  english.set(name, messages);
  const prefix = `${name.replaceAll("/", ".")}.`;
  for (const key of Object.keys(messages)) {
    if (!key.startsWith(prefix)) failures.push(`en/${name}.ts: ${key} does not start with ${prefix}`);
    const other = owner.get(key);
    if (other) failures.push(`${key} is in both en/${other}.ts and en/${name}.ts.`);
    owner.set(key, name);
  }
}

interface Coverage {
  translated: number;
  total: number;
}
const coverage: Record<string, Record<string, Coverage>> = {};
const untranslated: Record<string, string[]> = {};
const outOfOrder: string[] = [];
const fix = process.argv.includes("--fix");

for (const locale of TRANSLATED_LOCALES.filter((locale) => locale !== "en")) {
  const paths = modulePaths(locale);
  coverage[locale] = {};
  untranslated[locale] = [];
  for (const name of paths.keys()) {
    if (!english.has(name)) failures.push(`${locale}/${name}.ts has no English module.`);
  }
  for (const [name, source] of english) {
    const path = paths.get(name);
    if (!path) failures.push(`${locale}/${name}.ts is missing. Create it, even when it is empty.`);
    const translation = path ? await loadModule(path) : {};
    if (path && !isInOrder(Object.keys(translation), Object.keys(source))) {
      outOfOrder.push(`${locale}/${name}.ts`);
      if (fix) {
        try {
          writeFileSync(path, sortCatalog(readFileSync(path, "utf8"), Object.keys(source)));
        } catch (error) {
          failures.push(
            `${locale}/${name}.ts: --fix cannot sort it: ${error instanceof Error ? error.message : error}`,
          );
        }
      }
    }
    let translated = 0;
    for (const [key, message] of Object.entries(translation)) {
      const sourceMessage = source[key];
      if (sourceMessage === undefined) {
        failures.push(`${locale}/${name}.ts: ${key} is not an English key.`);
        continue;
      }
      if ((typeof sourceMessage === "string") !== (typeof message === "string")) {
        failures.push(`${locale}/${name}.ts: ${key} must have the same shape as English (text or plural forms).`);
      }
      if (typeof message !== "string" && typeof message.other !== "string") {
        failures.push(`${locale}/${name}.ts: ${key} has no "other" form.`);
      }
      const allowed = placeholders(sourceMessage);
      for (const placeholder of placeholders(message)) {
        if (!allowed.has(placeholder))
          failures.push(`${locale}/${name}.ts: ${key} uses {${placeholder}}, which English does not have.`);
      }
      translated += 1;
    }
    for (const key of Object.keys(source)) {
      if (!(key in translation)) untranslated[locale]?.push(key);
    }
    const area = name.split("/")[0] ?? name;
    const entry = coverage[locale][area] ?? { translated: 0, total: 0 };
    entry.translated += translated;
    entry.total += Object.keys(source).length;
    coverage[locale][area] = entry;
  }
}

// Each source template, with a number for {count} and its own placeholder text for the rest, must
// map back to its own key only.
for (const [name, messages] of english) {
  if (!name.startsWith("error/") && !name.startsWith("status/")) continue;
  for (const [key, message] of Object.entries(messages)) {
    for (const form of forms(message)) {
      const sample = form.replaceAll("{count}", "2");
      const matches = [...new Set(matchingSourceKeys(sample))];
      if (matches.length !== 1 || matches[0] !== key) {
        failures.push(
          `${key}: its English also matches ${matches.filter((match) => match !== key).join(", ") || "no template"}.`,
        );
      }
    }
  }
}

const code = CODE_ROOTS.flatMap((root) => files(resolve(ROOT, root), CODE_EXTENSIONS))
  .filter((path) => !path.startsWith(MESSAGES))
  .map((path) => readFileSync(path, "utf8"))
  .join("\n");
for (const [key, name] of owner) {
  if (!code.includes(`"${key}"`) && !code.includes(`'${key}'`) && !code.includes(`\`${key}\``)) {
    failures.push(`en/${name}.ts: ${key} is not used. Remove it, or name it as a literal where it renders.`);
  }
}

const report = {
  keys: owner.size,
  coverage,
  untranslated,
  outOfOrder,
  failures,
};

if (process.argv.includes("--json")) {
  const path = resolve(ROOT, ".openbot-build/i18n-report.json");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
  logger.info(`Wrote ${relative(ROOT, path)}.`);
}

const summary = Object.entries(coverage).map(([locale, areas]) => {
  const total = Object.values(areas).reduce((sum, area) => sum + area.total, 0);
  const translated = Object.values(areas).reduce((sum, area) => sum + area.translated, 0);
  return `${locale}: ${translated} of ${total} keys translated`;
});
logger.info([`${owner.size} English keys.`, ...summary].join("\n"));
if (outOfOrder.length > 0) {
  logger.info(
    fix
      ? `Put the keys of ${outOfOrder.length} modules in the English order.`
      : `${outOfOrder.length} modules do not have their keys in the English order. Run \`bun run i18n:check --fix\`.`,
  );
}

if (failures.length > 0) {
  logger.error(["The catalogs have problems:", ...failures.map((line) => `  ${line}`)].join("\n"));
  process.exitCode = 1;
}
