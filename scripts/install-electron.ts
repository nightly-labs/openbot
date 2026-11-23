import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ATTEMPTS = 3;
const NETWORK_FAILURE = /^(?:HTTPError: Response code (?:429|5\d\d) |TypeError: (?:fetch failed|terminated)$)/mu;

const installScript = join(dirname(dirname(fileURLToPath(import.meta.url))), "node_modules", "electron", "install.js");

for (let attempt = 1; ; attempt += 1) {
  const result = spawnSync("node", [installScript], { stdio: ["inherit", "inherit", "pipe"], encoding: "utf8" });
  if (result.error) throw result.error;
  process.stderr.write(result.stderr);
  if (result.status === 0) break;
  if (attempt === ATTEMPTS || !NETWORK_FAILURE.test(result.stderr)) process.exit(result.status ?? 1);
  process.stderr.write(`The Electron download failed (attempt ${attempt} of ${ATTEMPTS}). Trying again.\n`);
  await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 5_000));
}
