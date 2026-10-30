import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The root `postinstall` runs this in place of the `install-electron` command of the `electron`
// package. That command downloads the Electron archive from GitHub one time, and `@electron/get`
// has no retry. An HTTP 5xx or a lost connection then stops `bun install` (CI run 38577580296:
// HTTP 500; release run 38577404700: `TypeError: fetch failed`). So a network failure gets two
// more attempts. An HTTP 4xx, a checksum mismatch or an extraction failure stops at once. The
// command checks the archive against `checksums.json`, so a retry cannot change what it installs.

const ATTEMPTS = 3;
// `HTTPError` is the error of the `@electron/get` downloader. 429 is the GitHub rate-limit
// response. Node's fetch throws `fetch failed` when the connection or DNS fails, and `terminated`
// when the connection closes before the archive is complete.
const NETWORK_FAILURE = /^(?:HTTPError: Response code (?:429|5\d\d) |TypeError: (?:fetch failed|terminated)$)/mu;

const installScript = join(dirname(dirname(fileURLToPath(import.meta.url))), "node_modules", "electron", "install.js");

for (let attempt = 1; ; attempt += 1) {
  // The shebang of `install-electron` selects `node`, so the command runs in the same runtime.
  const result = spawnSync("node", [installScript], { stdio: ["inherit", "inherit", "pipe"], encoding: "utf8" });
  if (result.error) throw result.error;
  process.stderr.write(result.stderr);
  if (result.status === 0) break;
  if (attempt === ATTEMPTS || !NETWORK_FAILURE.test(result.stderr)) process.exit(result.status ?? 1);
  process.stderr.write(`The Electron download failed (attempt ${attempt} of ${ATTEMPTS}). Trying again.\n`);
  await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 5_000));
}
