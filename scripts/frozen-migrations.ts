// The rules of `check-frozen-migrations.ts`, without git, so the fixtures can run them.
//
// A user who upgrades runs each migration once, on a database that has no backup. A released
// migration that changes later gives two users of the same version two different databases. So a
// migration file that a release tag has never changes, and a fix is a new migration.

export const MIGRATIONS_DIR = "src/backend/migrations";

/** The first version in the folder: databases before it are pre-registry imports, not migrations. */
const FIRST_VERSION = 8;

/** Files that change with each new migration, or that only declare types. Every other file is frozen. */
const UNFROZEN_FILES: ReadonlySet<string> = new Set(["registry.ts", "migration.ts"]);

/** Shared frozen helpers that are not migrations. */
const SUPPORT_FILES: ReadonlySet<string> = new Set(["migration.ts", "runtime-values.ts"]);

const MIGRATION_FILE = /^(\d{4})-([a-z0-9]+(?:-[a-z0-9]+)*)\.ts$/;
const MIGRATION_DECLARATION = "export const migration: OpenBotMigration = {";

export interface ReleasedMigrations {
  readonly tag: string;
  /** File name to content, for each file in `MIGRATIONS_DIR` at the tag. Empty when the tag has no such folder. */
  readonly files: ReadonlyMap<string, string>;
  /** The newest migration version that the tag ships. */
  readonly maxVersion: number;
}

interface MigrationFile {
  readonly file: string;
  readonly version: number;
  readonly name: string;
}

/** The newest version of a `migrations/` folder, or of an older schema module that lists `version: N` entries. */
export function newestVersion(files: Iterable<string>, legacySchemaSource?: string): number {
  let newest = 0;
  for (const file of files) {
    const match = MIGRATION_FILE.exec(file);
    if (match) newest = Math.max(newest, Number(match[1]));
  }
  for (const match of legacySchemaSource?.matchAll(/^\s*version: (\d+),$/gm) ?? []) {
    newest = Math.max(newest, Number(match[1]));
  }
  return newest;
}

function importSources(content: string): string[] {
  return [...content.matchAll(/^(?:import|export)\b[^;]*?\bfrom\s+"([^"]+)"|^import\s+"([^"]+)"/gm)].map(
    (match) => match[1] ?? match[2] ?? "",
  );
}

function declaredField(content: string, field: "version" | "name"): string | undefined {
  const start = content.indexOf(MIGRATION_DECLARATION);
  if (start === -1) return undefined;
  const body = content.slice(start + MIGRATION_DECLARATION.length);
  const pattern = field === "version" ? /^\s*version: (\d+),$/m : /^\s*name: "([^"]*)",$/m;
  return pattern.exec(body)?.[1];
}

/** Each problem as one line. No problems means the folder is safe to ship. */
export function frozenMigrationProblems(current: ReadonlyMap<string, string>, released: ReleasedMigrations): string[] {
  const problems: string[] = [];
  const { tag } = released;

  for (const [file, content] of released.files) {
    if (UNFROZEN_FILES.has(file)) continue;
    const now = current.get(file);
    if (now === undefined) {
      problems.push(`${file}: ${tag} released this file, and it is gone or renamed. Restore it.`);
    } else if (now !== content) {
      problems.push(`${file}: changed after ${tag} released it. Restore it, and fix the bug in a new migration.`);
    }
  }

  const migrations: MigrationFile[] = [];
  for (const [file, content] of current) {
    if (file === "registry.ts" || SUPPORT_FILES.has(file)) continue;
    const match = MIGRATION_FILE.exec(file);
    if (!match) {
      problems.push(`${file}: not a migration file name. Use <4-digit version>-<kebab-case name>.ts.`);
      continue;
    }
    const version = Number(match[1]);
    const name = match[2] ?? "";
    migrations.push({ file, version, name });

    if (declaredField(content, "version") !== String(version)) {
      problems.push(`${file}: declares no \`version: ${version},\` in \`${MIGRATION_DECLARATION}\`.`);
    }
    if (declaredField(content, "name") !== name) {
      problems.push(`${file}: declares no \`name: "${name}",\` in \`${MIGRATION_DECLARATION}\`.`);
    }
    if (released.files.size > 0 && version <= released.maxVersion && !released.files.has(file)) {
      problems.push(
        `${file}: version ${version} is not above ${released.maxVersion}, the newest version in ${tag}. Use version ${released.maxVersion + 1} or above.`,
      );
    }
    for (const source of importSources(content)) {
      const sibling = MIGRATION_FILE.exec(`${source.slice(2)}.ts`);
      const allowed =
        source.startsWith("node:") ||
        source === "@openbot/logging" ||
        source === "./migration" ||
        source === "./runtime-values" ||
        (source.startsWith("./") &&
          sibling !== null &&
          Number(sibling[1]) < version &&
          current.has(`${source.slice(2)}.ts`));
      if (!allowed) {
        problems.push(
          `${file}: imports "${source}". A frozen migration imports only node:*, @openbot/logging, ./migration, ./runtime-values and earlier migrations; copy other code into the file.`,
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

  const registry = current.get("registry.ts");
  if (registry === undefined) {
    problems.push("registry.ts: missing.");
  } else {
    const imported = [...registry.matchAll(/from "\.\/(\d{4}-[a-z0-9-]+)"/g)].map((match) => `${match[1]}.ts`);
    const listed = /MIGRATIONS[^=]*=\s*\[([^\]]*)\]/.exec(registry)?.[1]?.match(/\bmigration\d{4}\b/g) ?? [];
    const expectedFiles = migrations.map((migration) => migration.file);
    const expectedIds = migrations.map((migration) => `migration${String(migration.version).padStart(4, "0")}`);
    if (imported.join() !== expectedFiles.join()) {
      problems.push("registry.ts: must import each migration file once, in version order.");
    }
    if (listed.join() !== expectedIds.join()) {
      problems.push("registry.ts: MIGRATIONS must list each migration once, in version order.");
    }
  }

  return problems;
}
