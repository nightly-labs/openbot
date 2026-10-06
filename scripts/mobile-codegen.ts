// Runs the mobile `codegen` script only when its inputs changed since the last run.
//
//   bun scripts/mobile-codegen.ts
//
// `expo customize` writes `expo-env.d.ts` and the typed routes in `.expo/types`, and Uniwind writes
// `src/uniwind-types.d.ts`. Together they take about 3 seconds, and `typecheck:mobile` needs them.
// A hash of the inputs, not file times, decides: a checkout or a rebase changes the times of files
// whose content is the same, and Uniwind does not write a file whose content did not change.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const MOBILE = "apps/mobile";

/** The files that the codegen reads, relative to the repository root. */
export const MOBILE_CODEGEN_INPUTS = [
  `${MOBILE}/app.json`,
  `${MOBILE}/global.css`,
  `${MOBILE}/package.json`,
  `${MOBILE}/tsconfig.json`,
  // `global.css` imports these.
  "packages/brand/src/tokens.css",
  "packages/brand/src/tokens-native.css",
  // The Expo, Uniwind and HeroUI versions.
  "bun.lock",
];

/** Expo Router makes one typed route for each file name in this folder. */
const ROUTES = `${MOBILE}/src/app`;

const OUTPUTS = [`${MOBILE}/expo-env.d.ts`, `${MOBILE}/.expo/types/router.d.ts`, `${MOBILE}/src/uniwind-types.d.ts`];
const STAMP = `${MOBILE}/.expo/codegen-inputs.sha256`;

function inputHash(): string {
  const hash = createHash("sha256");
  for (const path of MOBILE_CODEGEN_INPUTS) hash.update(`${path}\0`).update(readFileSync(join(ROOT, path)));
  const routes = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", ROUTES], {
    cwd: ROOT,
    encoding: "utf8",
  });
  return hash.update(routes).digest("hex");
}

if (import.meta.main) {
  const hash = inputHash();
  const stamp = join(ROOT, STAMP);
  const current =
    OUTPUTS.every((path) => existsSync(join(ROOT, path))) &&
    existsSync(stamp) &&
    readFileSync(stamp, "utf8").trim() === hash;
  if (current) {
    process.stdout.write("Mobile codegen outputs are current.\n");
  } else {
    execFileSync("bun", ["run", "codegen"], { cwd: join(ROOT, MOBILE), stdio: "inherit" });
    mkdirSync(dirname(stamp), { recursive: true });
    writeFileSync(stamp, `${hash}\n`);
  }
}
