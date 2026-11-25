import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { createOpenBotLogger } from "@openbot/logging";
import { bootedSimulatorIds, hasMobileRuntime } from "./dev-mobile";

const BUNDLE_ID = "run.openbot.mobile";
const APP_GROUP = "group.run.openbot.mobile";
const PAYLOAD_KEY = "expo-sharing";
const SHARE_LINK = "openbot://expo-sharing";
const OUT = resolve(import.meta.dirname, "../.openbot-build/mobile-share-e2e");
const RUNTIME_TIMEOUT_MS = 5 * 60_000;
const TAKE_TIMEOUT_MS = 2 * 60_000;
const POLL_INTERVAL_MS = 500;
const PNG_1PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const PDF =
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj " +
  "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 72 72]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n";

const logger = createOpenBotLogger("mobile-share-e2e");
const run = promisify(execFile);

interface SharePayload {
  type: "text" | "url" | "image" | "file";
  value: string;
  mimeType: string;
  metadata?: { originalName: string; size: number };
}

interface ShareCase {
  name: string;
  coldStart: boolean;
  text: { type: "text" | "url"; value: string }[];
  file?: { source: string; name: string; type: "image" | "file"; mimeType: string; expected: string };
}

interface CaseResult {
  name: string;
  coldStart: boolean;
  payloadTaken: boolean;
  appGroupCopyRemoved: boolean | null;
  receivedFile: string | null;
  screenshot: string;
}

function option(name: string): string | null {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) || null;
}

async function waitFor<T>(label: string, timeoutMs: number, probe: () => Promise<T | null>): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value !== null) return value;
    await new Promise((done) => setTimeout(done, POLL_INTERVAL_MS));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function selectSimulator(): Promise<string> {
  const requested = option("simulator");
  if (requested) return requested;
  const { stdout } = await run("xcrun", ["simctl", "list", "devices", "booted", "--json"]);
  const withApp: string[] = [];
  for (const udid of bootedSimulatorIds(JSON.parse(stdout))) {
    try {
      await run("xcrun", ["simctl", "get_app_container", udid, BUNDLE_ID]);
      withApp.push(udid);
    } catch {}
  }
  const [udid, ...extra] = withApp;
  if (!udid) throw new Error("No booted simulator has OpenBot installed. Run `bun run dev:mobile` first.");
  if (extra.length > 0) throw new Error(`Several booted simulators have OpenBot. Pass --simulator=<udid>.`);
  return udid;
}

async function container(udid: string, kind: string): Promise<string> {
  return (await run("xcrun", ["simctl", "get_app_container", udid, BUNDLE_ID, kind])).stdout.trim();
}

async function defaults(udid: string, args: string[]): Promise<boolean> {
  try {
    await run("xcrun", ["simctl", "spawn", udid, "defaults", ...args]);
    return true;
  } catch {
    return false;
  }
}

async function appRunning(metroPort: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${metroPort}/json/list`);
    return hasMobileRuntime(await response.json());
  } catch {
    return false;
  }
}

function findReceived(cacheRoot: string, name: string): string | null {
  const root = join(cacheRoot, "incoming-share");
  if (!existsSync(root)) return null;
  for (const folder of readdirSync(root)) {
    const file = join(root, folder, name);
    if (existsSync(file) && statSync(file).size > 0) return file;
  }
  return null;
}

async function makeFixtures(): Promise<{ png: string; heic: string; pdf: string; folder: string }> {
  const folder = mkdtempSync(join(tmpdir(), "openbot-share-e2e-"));
  const tiny = join(folder, "tiny.png");
  writeFileSync(tiny, Buffer.from(PNG_1PX, "base64"));
  const png = join(folder, "share-e2e.png");
  await run("sips", ["-z", "64", "64", tiny, "--out", png]);
  const heic = join(folder, "share-e2e-photo.heic");
  await run("sips", ["-s", "format", "heic", png, "--out", heic]);
  const pdf = join(folder, "share-e2e.pdf");
  writeFileSync(pdf, PDF);
  return { png, heic, pdf, folder };
}

async function main(): Promise<void> {
  if (!process.argv.includes("--allow-mutations")) {
    throw new Error("This test writes into the app's storage and opens the share sheet. Pass --allow-mutations.");
  }
  const metroPort = Number(option("metro-port") ?? 8081);
  const udid = await selectSimulator();
  const group = await container(udid, APP_GROUP);
  const cacheRoot = join(await container(udid, "data"), "Library", "Caches");
  const domain = join(group, "Library", "Preferences", APP_GROUP);
  const fixtures = await makeFixtures();
  mkdirSync(OUT, { recursive: true });

  const cases: ShareCase[] = [
    { name: "text", coldStart: false, text: [{ type: "text", value: "OpenBot share E2E text" }] },
    { name: "link", coldStart: false, text: [{ type: "url", value: "https://openbot.run/" }] },
    {
      name: "image",
      coldStart: false,
      text: [],
      file: {
        source: fixtures.png,
        name: "share-e2e.png",
        type: "image",
        mimeType: "image/png",
        expected: "share-e2e.png",
      },
    },
    {
      name: "heic-photo",
      coldStart: false,
      text: [],
      file: {
        source: fixtures.heic,
        name: "share-e2e-photo.heic",
        type: "image",
        mimeType: "image/heic",
        expected: "share-e2e-photo.jpg",
      },
    },
    {
      name: "file",
      coldStart: false,
      text: [],
      file: {
        source: fixtures.pdf,
        name: "share-e2e.pdf",
        type: "file",
        mimeType: "application/pdf",
        expected: "share-e2e.pdf",
      },
    },
    {
      name: "cold-start",
      coldStart: true,
      text: [{ type: "text", value: "OpenBot share E2E cold start" }],
      file: {
        source: fixtures.png,
        name: "share-e2e-cold.png",
        type: "image",
        mimeType: "image/png",
        expected: "share-e2e-cold.png",
      },
    },
  ];

  const results: CaseResult[] = [];
  try {
    for (const shareCase of cases) {
      logger.info(`Sharing ${shareCase.name}.`);
      if (shareCase.coldStart) {
        await run("xcrun", ["simctl", "terminate", udid, BUNDLE_ID]).catch(() => undefined);
      } else if (!(await appRunning(metroPort))) {
        await run("xcrun", ["simctl", "launch", udid, BUNDLE_ID]);
        await waitFor("the app's JavaScript runtime in Metro", RUNTIME_TIMEOUT_MS, async () =>
          (await appRunning(metroPort)) ? true : null,
        );
      }
      const payloads: SharePayload[] = shareCase.text.map(({ type, value }) => ({
        type,
        value,
        mimeType: type === "url" ? "text/html" : "text/plain",
      }));
      let groupCopy: string | null = null;
      if (shareCase.file) {
        groupCopy = join(group, shareCase.file.name);
        await run("cp", [shareCase.file.source, groupCopy]);
        payloads.push({
          type: shareCase.file.type,
          value: `file://${encodeURI(groupCopy)}`,
          mimeType: shareCase.file.mimeType,
          metadata: { originalName: shareCase.file.name, size: statSync(groupCopy).size },
        });
      }
      const hex = Buffer.from(JSON.stringify(payloads)).toString("hex");
      if (
        !(await defaults(udid, ["write", domain, PAYLOAD_KEY, "-data", hex])) ||
        !(await defaults(udid, ["read", domain, PAYLOAD_KEY]))
      ) {
        throw new Error("Could not write the share payload into the App Group defaults.");
      }
      await run("xcrun", ["simctl", "openurl", udid, SHARE_LINK]);
      await waitFor(`the app to take the ${shareCase.name} share (is the app signed in?)`, TAKE_TIMEOUT_MS, async () =>
        (await defaults(udid, ["read", domain, PAYLOAD_KEY])) ? null : true,
      );
      const expected = shareCase.file?.expected;
      const receivedFile = expected
        ? await waitFor(`${expected} in the app's share folder`, TAKE_TIMEOUT_MS, async () =>
            findReceived(cacheRoot, expected),
          )
        : null;
      const screenshot = join(OUT, `${shareCase.name}.png`);
      await run("xcrun", ["simctl", "io", udid, "screenshot", screenshot]);
      results.push({
        name: shareCase.name,
        coldStart: shareCase.coldStart,
        payloadTaken: true,
        appGroupCopyRemoved: groupCopy ? !existsSync(groupCopy) : null,
        receivedFile,
        screenshot,
      });
    }
  } finally {
    rmSync(fixtures.folder, { recursive: true, force: true });
    writeFileSync(join(OUT, "report.json"), `${JSON.stringify({ simulator: udid, results }, null, 2)}\n`);
  }
  const failed = results.filter((result) => result.appGroupCopyRemoved === false);
  if (failed.length > 0)
    throw new Error(`The App Group copy stayed for: ${failed.map(({ name }) => name).join(", ")}.`);
  logger.info(`Checked ${results.length} shares. Wrote ${join(OUT, "report.json")}.`);
}

main().catch((error: unknown) => {
  logger.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
