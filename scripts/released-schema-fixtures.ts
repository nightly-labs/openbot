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
const APPLIED_AT = "2026-01-01T00:00:00.000Z";

const dumpSchema = z.object({
  migrations: z.array(z.number().int()),
  objects: z.array(z.object({ type: z.string(), name: z.string(), sql: z.string() })),
});
type Dump = z.infer<typeof dumpSchema>;

function argumentValue(name: string): string | undefined {
  return process.argv.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
}

const childModule = argumentValue("dump");
const childDatabase = argumentValue("db");
if (childModule && childDatabase) {
  const source = await readFile(childModule, "utf8");
  const schema: { migrateOpenBotDatabase: (db: DatabaseSync, options: unknown) => void } = await import(childModule);
  const db = new DatabaseSync(childDatabase);
  schema.migrateOpenBotDatabase(
    db,
    source.includes("OpenBotMigrationOptions") ? { appliedAt: APPLIED_AT } : APPLIED_AT,
  );
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

async function exportTag(tag: string): Promise<string> {
  const directory = join(WORK, tag);
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  const archive = execFileSync("git", ["archive", "--format=tar", tag, "src/backend", "packages"], {
    cwd: ROOT,
    maxBuffer: 512 * 1024 * 1024,
  });
  execFileSync("tar", ["-x", "-C", directory], { input: archive });
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
  objects: string[];
}

type Item = number | string;

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
  releases.push({ tag, newInstall: change("newInstall"), ...(sameAsNew ? {} : { upgraded: change("upgraded") }) });
  previous = current;
  process.stderr.write(
    `${tag}: schema ${newInstall.migrations.at(-1)}, ${newInstall.objects.length} objects` +
      `${sameAsNew ? "" : `; upgraded: ${upgraded.objects.length} objects`}\n`,
  );
}
await rm(WORK, { recursive: true, force: true });

const sortedStatements = Object.fromEntries(Object.entries(statements).sort(([a], [b]) => a.localeCompare(b)));
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
