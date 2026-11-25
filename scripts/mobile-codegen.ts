import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const MOBILE = "apps/mobile";

export const MOBILE_CODEGEN_INPUTS = [
  `${MOBILE}/app.json`,
  `${MOBILE}/global.css`,
  `${MOBILE}/package.json`,
  `${MOBILE}/tsconfig.json`,
  "packages/brand/src/tokens.css",
  "packages/brand/src/tokens-native.css",
  "bun.lock",
];

const ROUTES = `${MOBILE}/src/app`;

const OUTPUTS = [`${MOBILE}/expo-env.d.ts`, `${MOBILE}/.expo/types/router.d.ts`, `${MOBILE}/src/uniwind-types.d.ts`];
const STAMP = `${MOBILE}/.expo/codegen-inputs.sha256`;

function inputHash(): string {
  const hash = createHash("sha256");
  for (const path of MOBILE_CODEGEN_INPUTS) hash.update(`${path}\0`).update(readFileSync(join(ROOT, path)));
  const routes = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", ROUTES], {
    cwd: ROOT,
    encoding: "utf8",
  })
    .split("\0")
    .filter((path) => path && existsSync(join(ROOT, path)));
  return hash.update(routes.join("\0")).digest("hex");
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
