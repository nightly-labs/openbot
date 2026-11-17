// Rule fixtures for `check-frozen-migrations.ts`: each rule stops its bad folder and passes a good one.
import { describe, expect, it } from "vitest";
import { frozenMigrationProblems, type ReleasedMigrations } from "./frozen-migrations";

const IMPORT_RULE =
  "A frozen migration imports only node:*, @openbot/logging, ./runtime-values, earlier migrations and types from ./migration; copy other code into the file.";

function migrationFile(version: number, name: string, imports = ""): string {
  return `${imports}import type { OpenBotMigration } from "./migration";

export const migration: OpenBotMigration = {
  version: ${version},
  name: "${name}",
  up: (db) => db.exec("SELECT ${version}"),
};
`;
}

function folder(entries: Record<string, string>, registryFiles = Object.keys(entries).sort()): Map<string, string> {
  const ids = registryFiles.map((file) => `migration${file.slice(0, 4)}`);
  const registry = [
    ...registryFiles.map((file, index) => `import { migration as ${ids[index]} } from "./${file.slice(0, -3)}";`),
    `export const MIGRATIONS: readonly OpenBotMigration[] = [${ids.join(", ")}];`,
  ].join("\n");
  return new Map([
    ...Object.entries(entries),
    ["migration.ts", "export interface OpenBotMigration {}\n"],
    ["runtime-values.ts", "export const isString = () => true;\n"],
    ["registry.ts", registry],
  ]);
}

const RELEASED_ENTRIES = {
  "0008-baseline.ts": migrationFile(8, "baseline"),
  "0009-channels.ts": migrationFile(9, "channels"),
};
const RELEASED: ReleasedMigrations = { tag: "v1.0.0", files: folder(RELEASED_ENTRIES) };

describe("frozen migrations", () => {
  it("passes a new migration with the next version, a changed registry and type, and a tag with no folder", () => {
    const withNew = folder({ ...RELEASED_ENTRIES, "0010-workflows.ts": migrationFile(10, "workflows") });
    withNew.set("migration.ts", "export interface OpenBotMigration { readonly note?: string }\n");
    expect(frozenMigrationProblems(withNew, RELEASED)).toEqual([]);
    expect(frozenMigrationProblems(withNew, { tag: "v0.72.0", files: new Map() })).toEqual([]);
  });

  it("stops an edit to a released file", () => {
    const current = folder(RELEASED_ENTRIES);
    current.set("runtime-values.ts", "export const isString = () => false;\n");
    expect(frozenMigrationProblems(current, RELEASED)).toEqual([
      "runtime-values.ts: changed after v1.0.0 released it. Restore it, and fix the bug in a new migration.",
    ]);
  });

  it("stops a removed or renamed released migration", () => {
    const current = folder({
      "0008-baseline.ts": RELEASED_ENTRIES["0008-baseline.ts"],
      "0009-channel-list.ts": migrationFile(9, "channel-list"),
    });
    expect(frozenMigrationProblems(current, RELEASED)).toEqual([
      "0009-channels.ts: v1.0.0 released this file, and it is gone or renamed. Restore it.",
      "0009-channel-list.ts: v1.0.0 released version 9. Use version 10 or above.",
    ]);
  });

  it("stops a repeated version and a repeated name", () => {
    const repeated = folder({
      ...RELEASED_ENTRIES,
      "0010-channels.ts": migrationFile(10, "channels"),
      "0010-workflows.ts": migrationFile(10, "workflows"),
    });
    expect(frozenMigrationProblems(repeated, RELEASED)).toEqual([
      '0010-channels.ts: another migration has the name "channels".',
      "0010-workflows.ts: expected version 11. Versions start at 8 and have no gaps or repeats.",
    ]);
  });

  it("stops a file whose name, version or declared name do not agree", () => {
    const current = folder(
      {
        ...RELEASED_ENTRIES,
        "0010-workflows.ts": migrationFile(11, "workflow-runs"),
        "notes.ts": "export const notes = 1;\n",
      },
      ["0008-baseline.ts", "0009-channels.ts", "0010-workflows.ts"],
    );
    expect(frozenMigrationProblems(current, RELEASED)).toEqual([
      "0010-workflows.ts: declares no `version: 10,` in `export const migration: OpenBotMigration = {`.",
      '0010-workflows.ts: declares no `name: "workflows",` in `export const migration: OpenBotMigration = {`.',
      "notes.ts: not a migration file name. Use <4-digit version>-<kebab-case name>.ts.",
    ]);
  });

  it("stops an import of live code or of a later migration", () => {
    const current = folder({
      ...RELEASED_ENTRIES,
      "0010-workflows.ts": migrationFile(
        10,
        "workflows",
        'import { isString } from "@openbot/contracts/runtime-values";\nimport { later } from "./0011-sessions";\nimport { baseline } from "./0008-baseline";\nimport { helper } from "./migration";\n',
      ),
      "0011-sessions.ts": migrationFile(11, "sessions", 'import type { DatabaseSync } from "node:sqlite";\n'),
    });
    expect(frozenMigrationProblems(current, RELEASED)).toEqual([
      `0010-workflows.ts: imports "@openbot/contracts/runtime-values". ${IMPORT_RULE}`,
      `0010-workflows.ts: imports "./0011-sessions". ${IMPORT_RULE}`,
      `0010-workflows.ts: imports "./migration". ${IMPORT_RULE}`,
    ]);
  });

  it("stops a registry that misses a migration", () => {
    const entries = { ...RELEASED_ENTRIES, "0010-workflows.ts": migrationFile(10, "workflows") };
    expect(frozenMigrationProblems(folder(entries, ["0008-baseline.ts", "0009-channels.ts"]), RELEASED)).toEqual([
      "registry.ts: must import each migration file once, in version order.",
      "registry.ts: MIGRATIONS must list each migration once, in version order.",
    ]);
  });
});
