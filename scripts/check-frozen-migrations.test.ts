// Rule fixtures for `check-frozen-migrations.ts`: each rule stops its bad folder and passes a good one.
import { describe, expect, it } from "vitest";
import { frozenMigrationProblems, newestVersion, type ReleasedMigrations } from "./frozen-migrations";

function migrationFile(version: number, name: string, imports = ""): string {
  return `${imports}import type { OpenBotMigration } from "./migration";

export const migration: OpenBotMigration = {
  version: ${version},
  name: "${name}",
  up: (db) => db.exec("SELECT ${version}"),
};
`;
}

function registryFor(files: readonly string[]): string {
  const ids = files.map((file) => `migration${file.slice(0, 4)}`);
  return [
    ...files.map((file, index) => `import { migration as ${ids[index]} } from "./${file.slice(0, -3)}";`),
    'import type { OpenBotMigration } from "./migration";',
    "",
    `export const MIGRATIONS: readonly OpenBotMigration[] = [${ids.join(", ")}];`,
    "",
  ].join("\n");
}

function folder(entries: Record<string, string>, registryFiles?: readonly string[]): Map<string, string> {
  const files = new Map(Object.entries(entries));
  files.set("migration.ts", "export interface OpenBotMigration {}\n");
  files.set("runtime-values.ts", "export const isString = () => true;\n");
  const migrations = registryFiles ?? Object.keys(entries).sort();
  files.set("registry.ts", registryFor(migrations));
  return files;
}

const RELEASED_ENTRIES = {
  "0008-baseline.ts": migrationFile(8, "baseline"),
  "0009-channels.ts": migrationFile(9, "channels"),
};
const RELEASED: ReleasedMigrations = { tag: "v1.0.0", files: folder(RELEASED_ENTRIES), maxVersion: 9 };

describe("frozen migrations", () => {
  it("passes the released folder and a new migration with the next version", () => {
    expect(frozenMigrationProblems(folder(RELEASED_ENTRIES), RELEASED)).toEqual([]);
    const withNew = folder({ ...RELEASED_ENTRIES, "0010-workflows.ts": migrationFile(10, "workflows") });
    expect(frozenMigrationProblems(withNew, RELEASED)).toEqual([]);
  });

  it("lets the registry and the type change, because each new migration changes them", () => {
    const current = folder(RELEASED_ENTRIES);
    current.set("migration.ts", "export interface OpenBotMigration { readonly note?: string }\n");
    expect(frozenMigrationProblems(current, RELEASED)).toEqual([]);
  });

  it("stops an edit to a released migration or a released helper", () => {
    const current = folder({ ...RELEASED_ENTRIES, "0009-channels.ts": `${migrationFile(9, "channels")}// fix\n` });
    current.set("runtime-values.ts", "export const isString = () => false;\n");
    expect(frozenMigrationProblems(current, RELEASED)).toEqual([
      "0009-channels.ts: changed after v1.0.0 released it. Restore it, and fix the bug in a new migration.",
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
      "0009-channel-list.ts: version 9 is not above 9, the newest version in v1.0.0. Use version 10 or above.",
    ]);
  });

  it("stops a gap, a repeated version and a repeated name", () => {
    const gap = folder({ ...RELEASED_ENTRIES, "0011-workflows.ts": migrationFile(11, "workflows") });
    expect(frozenMigrationProblems(gap, RELEASED)).toEqual([
      "0011-workflows.ts: expected version 10. Versions start at 8 and have no gaps or repeats.",
    ]);
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
        'import { isString } from "@openbot/contracts/runtime-values";\nimport { later } from "./0011-sessions";\nimport { baseline } from "./0008-baseline";\n',
      ),
      "0011-sessions.ts": migrationFile(11, "sessions", 'import type { DatabaseSync } from "node:sqlite";\n'),
    });
    expect(frozenMigrationProblems(current, RELEASED)).toEqual([
      '0010-workflows.ts: imports "@openbot/contracts/runtime-values". A frozen migration imports only node:*, @openbot/logging, ./migration, ./runtime-values and earlier migrations; copy other code into the file.',
      '0010-workflows.ts: imports "./0011-sessions". A frozen migration imports only node:*, @openbot/logging, ./migration, ./runtime-values and earlier migrations; copy other code into the file.',
    ]);
  });

  it("stops a registry that misses a migration or lists it out of order", () => {
    const entries = { ...RELEASED_ENTRIES, "0010-workflows.ts": migrationFile(10, "workflows") };
    expect(frozenMigrationProblems(folder(entries, ["0008-baseline.ts", "0009-channels.ts"]), RELEASED)).toEqual([
      "registry.ts: must import each migration file once, in version order.",
      "registry.ts: MIGRATIONS must list each migration once, in version order.",
    ]);
    const reordered = folder(entries, ["0008-baseline.ts", "0010-workflows.ts", "0009-channels.ts"]);
    expect(frozenMigrationProblems(reordered, RELEASED)).toHaveLength(2);
  });

  it("allows the moved migrations while the newest tag has no folder, and reads its newest version", () => {
    const legacy =
      "const MIGRATIONS = [\n  {\n    version: 9,\n    up: () => {},\n  },\n  {\n    version: 63,\n  },\n];\n";
    const maxVersion = newestVersion([], legacy);
    expect(maxVersion).toBe(63);
    expect(newestVersion(["0008-baseline.ts", "0012-channels.ts", "registry.ts"])).toBe(12);
    const legacyRelease: ReleasedMigrations = { tag: "v0.72.0", files: new Map(), maxVersion };
    expect(frozenMigrationProblems(folder(RELEASED_ENTRIES), legacyRelease)).toEqual([]);
  });
});
