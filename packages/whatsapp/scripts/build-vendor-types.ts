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
