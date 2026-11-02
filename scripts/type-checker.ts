// Runs the type checker with the given arguments, for example `--noEmit -p tsconfig.json`.
//
// The checker is tsrs, the Rust port of TypeScript, when tsrs has a binary for this computer. tsrs has
// binaries for macOS arm64 and Linux only, so Windows and Intel Macs run `tsc` from the `typescript`
// package. CI runs on Linux and always uses tsrs.
//
// tsrs follows a TypeScript 7.1 build, and `tsc` is the catalog `typescript` version. They can report
// different errors; the tsrs result in CI decides.

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import tsrsPackage from "tsrs/package.json" with { type: "json" };

const ROOT = resolve(import.meta.dirname, "..");

/** The script to run with Bun: the tsrs launcher, or `tsc` where tsrs has no binary. */
export function typeCheckerScript(): string {
  // Linux packages add a `-gnu` or `-musl` suffix. The tsrs launcher picks between them.
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
