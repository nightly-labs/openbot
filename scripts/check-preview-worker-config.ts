import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger } from "@openbot/logging";

// The trusted preview publisher (.github/workflows/cloudflare-preview.yml) uploads a Worker that a
// pull request built. The pull request also wrote the generated wrangler.json, so its Worker name,
// bindings, routes and `build.command` are untrusted. This compares that file with the one that
// `main` builds and allows only the keys below to differ: the code entry and the runtime version.
// Anything else, such as a binding to the production database, stops the upload.
//
// Usage: bun scripts/check-preview-worker-config.ts <trusted wrangler.json> <untrusted wrangler.json>

const MAY_DIFFER = new Set([
  "main",
  "compatibility_date",
  "compatibility_flags",
  // Where the build found its source config. Wrangler reads no code from these paths.
  "configPath",
  "userConfigPath",
]);

const logger = createOpenBotLogger("check-preview-worker-config");
const [trustedPath, untrustedPath] = process.argv.slice(2);
if (!trustedPath || !untrustedPath) {
  throw new Error(
    "Usage: bun scripts/check-preview-worker-config.ts <trusted wrangler.json> <untrusted wrangler.json>",
  );
}

const trusted = readConfig(trustedPath);
const untrusted = readConfig(untrustedPath);
const keys = [...new Set([...Object.keys(trusted), ...Object.keys(untrusted)])].sort();
const differences = keys.filter((key) => !MAY_DIFFER.has(key) && !isDeepStrictEqual(trusted[key], untrusted[key]));

if (typeof untrusted.main !== "string" || !isInside(untrusted.main)) {
  differences.push("main (must be a relative path inside the build output)");
}

if (differences.length > 0) {
  logger.error(
    [
      "The pull request built a Worker config that differs from main. The preview is not uploaded.",
      ...differences.map((key) => `  ${key}`),
      "A pull request that changes the preview Worker bindings, vars, routes or name gets no preview.",
    ].join("\n"),
  );
  process.exit(1);
}
logger.info(`The Worker config matches main (${keys.length} keys).`);

function readConfig(path: string): DynamicRecord {
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (!isDynamicRecord(parsed)) throw new Error(`${path} must hold a JSON object.`);
  return parsed;
}

function isInside(path: string): boolean {
  return !path.startsWith("/") && !path.split(/[\\/]/).includes("..");
}
