// The rules of `check-frozen-migrations.ts`, without git, so the fixtures can run them.
//
// A user who upgrades runs each migration once, on a database that has no backup. A released
// migration that changes later gives two users of the same version two different databases. So a
// migration file that a release tag has never changes, and a fix is a new migration.

export const MIGRATIONS_DIR = "src/backend/migrations";

/** The first version in the folder: databases before it are pre-registry imports, not migrations. */
const FIRST_VERSION = 8;
/** These change with each new migration. Every other released file is frozen. */
const UNFROZEN_FILES: ReadonlySet<string> = new Set(["registry.ts", "migration.ts"]);
const NOT_MIGRATIONS: ReadonlySet<string> = new Set([...UNFROZEN_FILES, "runtime-values.ts"]);
const ALLOWED_IMPORTS: ReadonlySet<string> = new Set(["@openbot/logging", "./runtime-values"]);
/** `migration.ts` is not frozen, so a migration takes only types from it: a value could change later. */
const TYPE_ONLY_IMPORTS: ReadonlySet<string> = new Set(["./migration"]);

const MIGRATION_FILE = /^(\d{4})-([a-z0-9]+(?:-[a-z0-9]+)*)\.ts$/;
const MIGRATION_DECLARATION = "export const migration: OpenBotMigration = {";

export interface ReleasedMigrations {
  readonly tag: string;
  /** File name to content, for each file in `MIGRATIONS_DIR` at the tag. Empty when the tag has no such folder. */
  readonly files: ReadonlyMap<string, string>;
}

function fileVersion(file: string): number {
  return Number(MIGRATION_FILE.exec(file)?.[1] ?? 0);
}

function declaredField(content: string, pattern: RegExp): string | undefined {
  const start = content.indexOf(MIGRATION_DECLARATION);
  return start === -1 ? undefined : pattern.exec(content.slice(start))?.[1];
}

/** Each problem as one line. No problems means the folder is safe to ship. */
export function frozenMigrationProblems(current: ReadonlyMap<string, string>, released: ReleasedMigrations): string[] {
  const problems: string[] = [];
  const { tag } = released;
  const releasedNewest = Math.max(0, ...[...released.files.keys()].map(fileVersion));

  for (const [file, content] of released.files) {
    if (UNFROZEN_FILES.has(file)) continue;
    const now = current.get(file);
    if (now === undefined) {
      problems.push(`${file}: ${tag} released this file, and it is gone or renamed. Restore it.`);
    } else if (now !== content) {
      problems.push(`${file}: changed after ${tag} released it. Restore it, and fix the bug in a new migration.`);
    }
  }

  const migrations: { file: string; version: number; name: string }[] = [];
  for (const [file, content] of current) {
    if (NOT_MIGRATIONS.has(file)) continue;
    const match = MIGRATION_FILE.exec(file);
    if (!match) {
      problems.push(`${file}: not a migration file name. Use <4-digit version>-<kebab-case name>.ts.`);
      continue;
    }
    const version = Number(match[1]);
    const name = match[2] ?? "";
    migrations.push({ file, version, name });

    if (declaredField(content, /^\s*version: (\d+),$/m) !== String(version)) {
      problems.push(`${file}: declares no \`version: ${version},\` in \`${MIGRATION_DECLARATION}\`.`);
    }
    if (declaredField(content, /^\s*name: "([^"]*)",$/m) !== name) {
      problems.push(`${file}: declares no \`name: "${name}",\` in \`${MIGRATION_DECLARATION}\`.`);
    }
    if (version <= releasedNewest && !released.files.has(file)) {
      problems.push(`${file}: ${tag} released version ${version}. Use version ${releasedNewest + 1} or above.`);
    }
    for (const [, keyword = "", from = "", bare = ""] of content.matchAll(
      /^(import\s+type\b|import|export)\b[^;]*?\bfrom\s+"([^"]+)"|^import\s+"([^"]+)"/gm,
    )) {
      const source = from || bare;
      const earlier = `${source.slice(2)}.ts`;
      const allowed =
        source.startsWith("node:") ||
        ALLOWED_IMPORTS.has(source) ||
        (TYPE_ONLY_IMPORTS.has(source) && /^import\s+type\b/.test(keyword)) ||
        (source.startsWith("./") && fileVersion(earlier) > 0 && fileVersion(earlier) < version && current.has(earlier));
      if (!allowed) {
        problems.push(
          `${file}: imports "${source}". A frozen migration imports only node:*, @openbot/logging, ./runtime-values, earlier migrations and types from ./migration; copy other code into the file.`,
        );
      }
    }
  }

  migrations.sort((left, right) => left.version - right.version || left.file.localeCompare(right.file));
  const names = new Set<string>();
  migrations.forEach((migration, index) => {
    const expected = FIRST_VERSION + index;
    if (migration.version !== expected) {
      problems.push(
        `${migration.file}: expected version ${expected}. Versions start at ${FIRST_VERSION} and have no gaps or repeats.`,
      );
    }
    if (names.has(migration.name)) {
      problems.push(`${migration.file}: another migration has the name "${migration.name}".`);
    }
    names.add(migration.name);
  });

  const registry = current.get("registry.ts") ?? "";
  const imported = [...registry.matchAll(/from "\.\/(\d{4}-[a-z0-9-]+)"/g)].map((match) => `${match[1]}.ts`);
  const listed = /MIGRATIONS[^=]*=\s*\[([^\]]*)\]/.exec(registry)?.[1]?.match(/\bmigration\d{4}\b/g) ?? [];
  if (imported.join() !== migrations.map((migration) => migration.file).join()) {
    problems.push("registry.ts: must import each migration file once, in version order.");
  }
  if (listed.join() !== migrations.map((migration) => `migration${migration.file.slice(0, 4)}`).join()) {
    problems.push("registry.ts: MIGRATIONS must list each migration once, in version order.");
  }

  return problems;
}
