import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import tsrsPackage from "tsrs/package.json" with { type: "json" };

const ROOT = resolve(import.meta.dirname, "..");

export function typeCheckerScript(): string {
  const platformPackage = `@tsrs/${process.platform}-${process.arch}`;
  const hasBinary = Object.keys(tsrsPackage.optionalDependencies).some(
    (name) => name === platformPackage || name.startsWith(`${platformPackage}-`),
  );
  if (!hasBinary) return resolve(ROOT, "node_modules/typescript/bin/tsc");
  const packageFolder = dirname(createRequire(import.meta.url).resolve("tsrs/package.json"));
  return join(packageFolder, tsrsPackage.bin.tsrs);
}

if (import.meta.main) {
  const result = spawnSync(process.execPath, [typeCheckerScript(), ...process.argv.slice(2)], { stdio: "inherit" });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}
