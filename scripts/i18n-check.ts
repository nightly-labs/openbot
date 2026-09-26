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
// Reports, and does not fail on, keys that are not translated yet. `--json` writes the report to
// .openbot-build/i18n-report.json.

const ROOT = resolve(import.meta.dirname, "..");
const MESSAGES = resolve(ROOT, "packages/i18n/src/messages");
/** Files that spread area modules together. They hold no keys of their own. */
const AGGREGATORS = new Set(["index", "mobile", "source", "shared"]);
/** Where code that names a key lives. The catalogs themselves are left out. */
const CODE_ROOTS = ["src", "packages", "apps/mobile/src", "scripts"];
const CODE_EXTENSIONS = /\.(?:ts|tsx)$/;
const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", "build", "out", ".expo"]);

const logger = createOpenBotLogger("i18n-check");
const failures: string[] = [];

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

if (failures.length > 0) {
  logger.error(["The catalogs have problems:", ...failures.map((line) => `  ${line}`)].join("\n"));
  process.exitCode = 1;
}
