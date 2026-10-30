// A deploy replaces every file under /assets/. A tab that opened before the deploy then asks for a code
// file that the new build does not have, and the page reloads (issue #4087). Before `wrangler deploy`,
// this script copies the files of earlier builds from the live site into the new build, so an open
// tab keeps working for `RETENTION_MS` after its build stops being live.
//
// The live site holds its own history in `/asset-history.json`: each file name under /assets/, with
// the time a deploy replaced the build that had it, or null while a live build has it.
// `bun apps/auth-api/scripts/keep-previous-assets.ts [--origin=<url>] [--client=<dir>]`
import { existsSync } from "node:fs";
import { readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Option, Schema } from "effect";

const logger = createOpenBotLogger("keep-previous-assets");

const ASSET_HISTORY_FILE = "asset-history.json";
const PRODUCTION_ORIGIN = "https://openbot.run";
/** A tab that stays open for longer than this after a deploy reloads when it next loads code. */
const RETENTION_MS = 24 * 60 * 60 * 1000;
/** A Workers static asset version holds at most 20,000 files. One build has about 850. */
const MAX_KEPT_FILES = 10_000;
const DOWNLOAD_CONCURRENCY = 16;
/** A stalled request must not hold the deploy until the job times out. */
const REQUEST_TIMEOUT_MS = 30_000;
/** Vite writes flat names. A name with a separator, or a dot name, is not a file under /assets/. */
const ASSET_NAME = /^[^./\\][^/\\]*$/u;

const AssetHistory = Schema.Struct({
  version: Schema.Literal(1),
  files: Schema.Record(Schema.String, Schema.NullOr(Schema.Number)),
});
type AssetHistory = typeof AssetHistory.Type;

interface KeepPreviousAssetsResult {
  built: number;
  kept: number;
  /** Files of the history that the live site no longer has. */
  missing: number;
  /** Files that could not be downloaded for another reason. */
  failed: number;
  /** Files that are too old, or more than `MAX_KEPT_FILES`. */
  expired: number;
  historyFound: boolean;
}

async function keepPreviousAssets(options: { origin: string; clientDir: string }): Promise<KeepPreviousAssetsResult> {
  const now = Date.now();
  const assetsDir = join(options.clientDir, "assets");
  const built = new Set(await readdir(assetsDir));
  const history = await readLiveHistory(options.origin, now);

  const retired: [name: string, retiredAt: number][] = [];
  for (const [name, retiredAt] of Object.entries(history?.files ?? {})) {
    if (built.has(name) || !ASSET_NAME.test(name)) continue;
    // A file that a live build had stops being live with this deploy. A time after now comes from a
    // computer with a fast clock, and would keep the file for longer than `RETENTION_MS`.
    retired.push([name, Math.min(retiredAt ?? now, now)]);
  }
  retired.sort((a, b) => b[1] - a[1]);
  const candidates = retired.filter(([, retiredAt]) => now - retiredAt <= RETENTION_MS).slice(0, MAX_KEPT_FILES);

  const files: Record<string, number | null> = {};
  for (const name of built) files[name] = null;
  let missing = 0;
  let failed = 0;
  // The downloads share one iterator, so each file is downloaded once.
  const queue = candidates.values();
  async function download(): Promise<void> {
    for (const [name, retiredAt] of queue) {
      const result = await downloadAsset(options.origin, name);
      if (result === "missing") missing += 1;
      else if (result === "failed") failed += 1;
      else {
        await writeFile(join(assetsDir, name), result);
        files[name] = retiredAt;
      }
    }
  }
  await Promise.all(Array.from({ length: DOWNLOAD_CONCURRENCY }, download));

  const nextHistory: AssetHistory = { version: 1, files };
  await writeFile(join(options.clientDir, ASSET_HISTORY_FILE), `${JSON.stringify(nextHistory)}\n`);
  const kept = Object.values(files).filter((value) => value !== null).length;
  return {
    built: built.size,
    kept,
    missing,
    failed,
    expired: retired.length - candidates.length,
    historyFound: history !== null,
  };
}

/** Null when the live site has no history yet, as on the first deploy with this script. */
async function readLiveHistory(origin: string, now: number): Promise<AssetHistory | null> {
  // The query keeps a cached copy from an earlier deploy out of the answer.
  const url = new URL(`/${ASSET_HISTORY_FILE}?deploy=${now}`, origin);
  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (error) {
    warn("The live asset history could not be read. Only this build's files are deployed.", error);
    return null;
  }
  if (response.status === 404) return null;
  if (!response.ok) {
    warn(`The live asset history answered ${response.status}. Only this build's files are deployed.`);
    return null;
  }
  const decoded = Schema.decodeUnknownOption(AssetHistory)(await response.json().catch(() => undefined));
  if (Option.isNone(decoded)) {
    warn("The live asset history is not readable. Only this build's files are deployed.");
    return null;
  }
  return decoded.value;
}

async function downloadAsset(origin: string, name: string): Promise<Uint8Array | "missing" | "failed"> {
  try {
    const response = await fetch(new URL(`/assets/${encodeURIComponent(name)}`, origin), {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.status === 404) return "missing";
    // A page in place of a code file is the Worker's answer for a path with no file.
    if (!response.ok || response.headers.get("content-type")?.startsWith("text/html")) return "failed";
    return new Uint8Array(await response.arrayBuffer());
  } catch {
    return "failed";
  }
}

/**
 * Fewer kept files do not stop the deploy: a tab that needs a missing file reloads, as before this
 * script. In CI, the warning also shows on the run, so a failure that repeats is seen.
 */
function warn(message: string, error?: unknown): void {
  logger.warn(message, ...(error === undefined ? [] : [toLogValue(error)]));
  if (process.env.GITHUB_ACTIONS === "true") process.stdout.write(`::warning title=Earlier code files::${message}\n`);
}

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

const clientDir = resolve(argument("client") ?? join(import.meta.dirname, "..", "dist", "client"));
if (!existsSync(join(clientDir, "assets"))) {
  logger.error(`${clientDir} has no assets directory. Build the Worker first.`);
  process.exit(1);
}
const result = await keepPreviousAssets({ origin: argument("origin") ?? PRODUCTION_ORIGIN, clientDir });
if (result.failed > 0) warn(`${result.failed} code files of earlier builds could not be downloaded.`);
// The end-to-end test reads the last line.
process.stdout.write(`${JSON.stringify(result)}\n`);
