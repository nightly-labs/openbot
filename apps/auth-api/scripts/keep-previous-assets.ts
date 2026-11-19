import { existsSync } from "node:fs";
import { readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Option, Schema } from "effect";

const logger = createOpenBotLogger("keep-previous-assets");

const ASSET_HISTORY_FILE = "asset-history.json";
const PRODUCTION_ORIGIN = "https://openbot.run";
const RETENTION_MS = 24 * 60 * 60 * 1000;
const MAX_KEPT_FILES = 10_000;
const DOWNLOAD_CONCURRENCY = 16;
const REQUEST_TIMEOUT_MS = 30_000;
const ASSET_NAME = /^[^./\\][^/\\]*$/u;

const AssetHistory = Schema.Struct({
  version: Schema.Literal(1),
  files: Schema.Record(Schema.String, Schema.NullOr(Schema.Number)),
});
type AssetHistory = typeof AssetHistory.Type;

interface KeepPreviousAssetsResult {
  built: number;
  kept: number;
  missing: number;
  failed: number;
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
    retired.push([name, Math.min(retiredAt ?? now, now)]);
  }
  retired.sort((a, b) => b[1] - a[1]);
  const candidates = retired.filter(([, retiredAt]) => now - retiredAt <= RETENTION_MS).slice(0, MAX_KEPT_FILES);

  const files: Record<string, number | null> = {};
  for (const name of built) files[name] = null;
  let missing = 0;
  let failed = 0;
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

async function readLiveHistory(origin: string, now: number): Promise<AssetHistory | null> {
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
    if (!response.ok || response.headers.get("content-type")?.startsWith("text/html")) return "failed";
    return new Uint8Array(await response.arrayBuffer());
  } catch {
    return "failed";
  }
}

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
process.stdout.write(`${JSON.stringify(result)}\n`);
