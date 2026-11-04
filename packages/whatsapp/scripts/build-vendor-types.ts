// Writes the declaration files of the vendored Baileys to vendor/baileys/types.
//
// The vendored source keeps upstream's style and type options, so the repository's own type checks
// must not read it. The package exports `./baileys` with a `types` condition that points to these
// declarations (checked with `skipLibCheck`) and a `default` condition that points to the source,
// which the bundler and Bun read. Run this after every change under vendor/baileys/src:
// `bun run --cwd packages/whatsapp vendor:types`.

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { typeCheckerScript } from "../../../scripts/type-checker";

const PACKAGE = resolve(import.meta.dirname, "..");
const TYPES = join(PACKAGE, "vendor/baileys/types");
const out = mkdtempSync(join(tmpdir(), "openbot-baileys-types-"));

try {
  const result = spawnSync(
    process.execPath,
    [
      typeCheckerScript(),
      "-p",
      join(PACKAGE, "vendor/tsconfig.json"),
      "--noEmit",
      "false",
      "--declaration",
      "--emitDeclarationOnly",
      "--incremental",
      "false",
      // The vendor imports OpenBot's curve module, so the root is the package folder.
      "--rootDir",
      PACKAGE,
      "--outDir",
      out,
    ],
    { stdio: "inherit" },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
  const emitted = join(out, "vendor/baileys/src");
  if (!existsSync(emitted)) throw new Error(`No declarations under ${emitted}.`);
  rmSync(TYPES, { recursive: true, force: true });
  cpSync(emitted, TYPES, { recursive: true });
} finally {
  rmSync(out, { recursive: true, force: true });
}
