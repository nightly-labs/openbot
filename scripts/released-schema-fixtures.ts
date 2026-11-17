// Writes `src/backend/released-schemas/releases.json`: the schema of a new database and of an upgraded
// database that each shipped release made, taken from the release tags with git, not written by hand.
//
// For each tag, the script exports `src/backend` and `packages` of that tag (`git archive`) to
// `.openbot-build/released-schema-fixtures/<tag>`, links the tag's own `@openbot/*` packages, and runs
// the tag's own `migrateOpenBotDatabase` in a child process two times: on an empty database (a new
// install), and on the database that the previous tag upgraded (an install that upgraded through every
// release from the first one). Each run reads `sqlite_master` and `schema_migrations`.
//
// The file stays small: an entry is written only for a tag whose databases differ from the tag before,
// each SQL statement is stored once and referred to by its hash, and each list is stored as a change of
// the same list in the entry before (`src/backend/migration-harness.ts` reads it back). So a release
// that does not change the schema does not change the file. Run this script after a release that does:
//
//   bun scripts/released-schema-fixtures.ts [--check]
//
// `--check` writes nothing and exits non-zero when the file is not up to date. The `Check` job of CI
// runs it.
// The tags before v0.1.12 have no database. The tags before v0.3.0 have no migration registry; their
// schemas are also in `src/backend/released-schemas/v*.sql`, which the pre-registry test reads.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";

const ROOT = resolve(import.meta.dirname, "..");
const WORK = join(ROOT, ".openbot-build", "released-schema-fixtures");
const OUTPUT = join(ROOT, "src", "backend", "released-schemas", "releases.json");
const SCHEMA_MODULE = "src/backend/openbot-database-schema.ts";
const FIRST_DATABASE_TAG = "v0.1.12";
// The value is fixed so that the output does not change from one run to the next.
const APPLIED_AT = "2026-01-01T00:00:00.000Z";

const dumpSchema = z.object({
  migrations: z.array(z.number().int()),
  objects: z.array(z.object({ type: z.string(), name: z.string(), sql: z.string() })),
});
type Dump = z.infer<typeof dumpSchema>;

function argumentValue(name: string): string | undefined {
  return process.argv.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
}

// The child: run one tag's migration code on a database file and print what it made.
const childModule = argumentValue("dump");
const childDatabase = argumentValue("db");
if (childModule && childDatabase) {
  const source = await readFile(childModule, "utf8");
  const schema: { migrateOpenBotDatabase: (db: DatabaseSync, options: unknown) => void } = await import(childModule);
  const db = new DatabaseSync(childDatabase);
  // Releases before v0.3.0 take the applied time as the second argument; later ones take options.
  schema.migrateOpenBotDatabase(
    db,
    source.includes("OpenBotMigrationOptions") ? { appliedAt: APPLIED_AT } : APPLIED_AT,
  );
  // SQLite makes the shadow tables of a full-text index itself, so a replay must not create them.
  const shadowTables = new Set(
    db
      .prepare("SELECT name FROM pragma_table_list WHERE type = 'shadow'")
      .all()
      .map((row) => String(row.name)),
  );
  const dump: Dump = {
    migrations: db
      .prepare("SELECT version FROM schema_migrations ORDER BY version")
      .all()
      .map((row) => Number(row.version)),
    // Creation order, so that a table comes before its indexes.
    objects: db
      .prepare(
        `SELECT type, name, sql FROM sqlite_master
         WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid`,
      )
      .all()
      .filter((row) => !shadowTables.has(String(row.name)))
      .map((row) => ({
        type: String(row.type),
        name: String(row.name),
        sql: String(row.sql),
      })),
  };
  db.close();
  process.stdout.write(JSON.stringify(dump));
  process.exit(0);
}

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function compareVersions(left: string, right: string): number {
  const a = left.slice(1).split(".").map(Number);
  const b = right.slice(1).split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function releaseTags(): string[] {
  return git("tag", "--list", "v*")
    .split("\n")
    .filter((tag) => /^v\d+\.\d+\.\d+$/u.test(tag))
    .filter((tag) => compareVersions(tag, FIRST_DATABASE_TAG) >= 0)
    .sort(compareVersions);
}

/** Exports the tag and returns the path of its schema module. */
async function exportTag(tag: string): Promise<string> {
  const directory = join(WORK, tag);
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  const archive = execFileSync("git", ["archive", "--format=tar", tag, "src/backend", "packages"], {
    cwd: ROOT,
    maxBuffer: 512 * 1024 * 1024,
  });
  execFileSync("tar", ["-x", "-C", directory], { input: archive });
  // The tag's own packages, so that its code runs with the helpers it shipped with. Other
  // dependencies come from the node_modules of this checkout.
  await mkdir(join(directory, "node_modules", "@openbot"), { recursive: true });
  for (const name of git("ls-tree", "--name-only", `${tag}:packages`).split("\n").filter(Boolean)) {
    await symlink(join(directory, "packages", name), join(directory, "node_modules", "@openbot", name), "dir");
  }
  return join(directory, SCHEMA_MODULE);
}

function dumpDatabase(schemaModule: string, database: string): Dump {
  const output = execFileSync(process.execPath, [import.meta.filename, `--dump=${schemaModule}`, `--db=${database}`], {
    cwd: join(schemaModule, "..", "..", ".."),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "inherit"],
  });
  return dumpSchema.parse(JSON.parse(output));
}

function hashOf(sql: string): string {
  return createHash("sha256").update(sql).digest("hex").slice(0, 16);
}

interface ReleasedSchema {
  migrations: number[];
  /** The hash of each statement in `statements`, in the order that SQLite stores them. */
  objects: string[];
}

type Item = number | string;

/**
 * Writes `list` as a change of `base`: an item is kept as it is, and `[start, end]` stands for the
 * items `start` to `end - 1` of `base`. The decoder is `releasedDatabaseCases` in the harness.
 */
function encode(base: readonly Item[], list: readonly Item[]): (Item | [number, number])[] {
  const encoded: (Item | [number, number])[] = [];
  for (let index = 0; index < list.length; ) {
    let longest = { start: 0, length: 0 };
    base.forEach((_, start) => {
      let length = 0;
      while (start + length < base.length && base[start + length] === list[index + length]) length += 1;
      if (length > longest.length) longest = { start, length };
    });
    if (longest.length >= 2) {
      encoded.push([longest.start, longest.start + longest.length]);
      index += longest.length;
    } else {
      encoded.push(...list.slice(index, index + 1));
      index += 1;
    }
  }
  return encoded;
}

const statements: Record<string, string> = {};
function releasedSchema(dump: Dump): ReleasedSchema {
  const objects = dump.objects.map((object) => {
    const hash = hashOf(object.sql);
    statements[hash] = object.sql;
    return hash;
  });
  return { migrations: dump.migrations, objects };
}

const releases: object[] = [];
const empty: ReleasedSchema = { migrations: [], objects: [] };
let previous = { newInstall: empty, upgraded: empty };
const upgradedDatabase = join(WORK, "upgraded.db");
await rm(WORK, { recursive: true, force: true });
for (const tag of releaseTags()) {
  const schemaModule = await exportTag(tag);
  const newDatabase = join(WORK, `${tag}.db`);
  const newInstall = releasedSchema(dumpDatabase(schemaModule, newDatabase));
  // The first tag starts the upgrade chain with its new database.
  if (releases.length === 0) await copyFile(newDatabase, upgradedDatabase);
  const upgraded = releasedSchema(dumpDatabase(schemaModule, upgradedDatabase));
  await rm(join(WORK, tag), { recursive: true, force: true });
  const current = { newInstall, upgraded };
  if (JSON.stringify(current) === JSON.stringify(previous)) continue;
  const change = (kind: keyof typeof current) => ({
    migrations: encode(previous[kind].migrations, current[kind].migrations),
    objects: encode(previous[kind].objects, current[kind].objects),
  });
  const sameAsNew = JSON.stringify(upgraded) === JSON.stringify(newInstall);
  // `upgraded` is left out when it is the same as `newInstall`.
  releases.push({ tag, newInstall: change("newInstall"), ...(sameAsNew ? {} : { upgraded: change("upgraded") }) });
  previous = current;
  process.stderr.write(
    `${tag}: schema ${newInstall.migrations.at(-1)}, ${newInstall.objects.length} objects` +
      `${sameAsNew ? "" : `; upgraded: ${upgraded.objects.length} objects`}\n`,
  );
}
await rm(WORK, { recursive: true, force: true });

const sortedStatements = Object.fromEntries(Object.entries(statements).sort(([a], [b]) => a.localeCompare(b)));
// Biome formats the file as the pre-commit hook would, so that `--check` compares the same text.
const text = execFileSync(join(ROOT, "node_modules", ".bin", "biome"), ["format", `--stdin-file-path=${OUTPUT}`], {
  cwd: ROOT,
  encoding: "utf8",
  input: JSON.stringify({ releases, statements: sortedStatements }),
});
if (process.argv.includes("--check")) {
  const current = await readFile(OUTPUT, "utf8").catch(() => "");
  if (current !== text) {
    process.stderr.write(`${OUTPUT} is not up to date. Run: bun scripts/released-schema-fixtures.ts\n`);
    process.exit(1);
  }
} else {
  await writeFile(OUTPUT, text);
  process.stderr.write(`Wrote ${releases.length} release schemas, ${Object.keys(statements).length} statements.\n`);
}
