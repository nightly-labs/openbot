// Runs one real Grok agent turn through `GrokAgentClient` and asks for one image and one short
// video. It checks that the driver turns the Grok media tools (`grok-media.ts`) into an
// `imageGeneration` and a `videoGeneration` item, each with the file that Grok wrote. It uses a copy
// of the user's Grok login (see `grok-live-harness.ts`) and a temporary workspace. Costs one Grok
// session with one image and one video of about two seconds. `bun scripts/grok-media-smoke.ts`;
// `--model=<id>` replaces Grok Build Fast. Writes .openbot-build/grok-media-smoke/report.json and a
// copy of each file.
import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import type { AgentClient } from "../src/backend/agent-client";
import { resolveGrokCli } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { getString, isRecord } from "../src/backend/protocol";
import { NO_PROVIDER_CREDENTIALS, requireProviderDriver } from "../src/backend/provider-drivers";
import { grokEnvironment, makeGitWorkspace, makeGrokHome, startGrokProxy } from "./grok-live-harness";
import { runTurn, startThread, stopClients } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/grok-media-smoke");
const MODEL = process.argv.find((arg) => arg.startsWith("--model="))?.slice("--model=".length) ?? "grok-4.7-build-fast";
const TASK = [
  "Do these two steps in order.",
  "1. Generate one square image of a red apple on a white table.",
  "2. Generate one video of a red apple that rolls slowly across a white table. Make it as short as the tool allows.",
  "Then reply with the single word DONE.",
].join("\n");

interface MediaItem {
  event: string;
  type: string;
  status: string | null;
  savedPath: string | null;
  aspectRatio: string | null;
  resolution: string | null;
  duration: number | null;
  error: string | null;
}

interface Report {
  passed: boolean;
  model: string;
  grokVersion?: string;
  status?: string | null;
  reply?: string;
  items: MediaItem[];
  files: Array<{ type: string; copy: string; bytes: number; signature: string }>;
  error?: string;
}

const report: Report = { passed: false, model: MODEL, items: [], files: [] };
const proxy = await startGrokProxy();
const saved = { ...process.env };
const clients: AgentClient[] = [];
const root = await realpath(await mkdtemp(join(tmpdir(), "openbot-grok-media-smoke-")));

/** A short name of the file kind from its first bytes. */
function signature(bytes: Buffer): "png" | "jpeg" | "webp" | "mp4" | "unknown" {
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "jpeg";
  if (bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP")
    return "webp";
  if (bytes.subarray(4, 8).toString("latin1") === "ftyp") return "mp4";
  return "unknown";
}

try {
  mkdirSync(OUT, { recursive: true });
  const grokHome = await makeGrokHome(root, {});
  const workspace = join(root, "workspace");
  makeGitWorkspace(workspace);
  process.env = grokEnvironment(root, grokHome, proxy.port);
  const cli = await runCauseEffect(resolveGrokCli({ bundledExecutable: process.env.GROK_CLI ?? null }));
  report.grokVersion = cli.version;
  const client = requireProviderDriver("grok").createClient(cli, 120_000, NO_PROVIDER_CREDENTIALS);
  clients.push(client);
  client.on("request", (request) => {
    if (request.method.endsWith("/requestApproval")) client.respond(request.id, { decision: "accept" });
    else client.respondError(request.id, { code: -32601, message: `The smoke does not answer ${request.method}.` });
  });
  client.on("notification", (notification) => {
    if (notification.method !== "item/started" && notification.method !== "item/completed") return;
    const item = isRecord(notification.params) ? notification.params.item : null;
    if (!isRecord(item) || (item.type !== "imageGeneration" && item.type !== "videoGeneration")) return;
    report.items.push({
      event: notification.method,
      type: String(item.type),
      status: getString(item, "status"),
      savedPath: getString(item, "saved_path"),
      aspectRatio: getString(item, "aspect_ratio"),
      resolution: getString(item, "resolution"),
      duration: typeof item.duration === "number" ? item.duration : null,
      error: getString(item, "error"),
    });
  });
  client.start();
  const thread = await startThread(client, {
    cwd: workspace,
    model: MODEL,
    developerInstructions: "You are Ada, a careful assistant in an end-to-end smoke test.",
  });
  const turn = await runTurn(client, thread, { model: MODEL, text: TASK, timeoutMs: 600_000 });
  report.status = turn.status;
  report.reply = turn.reply;
  await stopClients([client]);
  process.env = { ...saved };

  assert.equal(turn.status, "completed", `The turn ended ${turn.status}: ${turn.error ?? ""}`);
  for (const type of ["imageGeneration", "videoGeneration"]) {
    const items = report.items.filter((item) => item.type === type);
    assert.ok(
      items.some((item) => item.event === "item/started" && item.status === "in_progress"),
      `No ${type} item started.`,
    );
    const done = items.find((item) => item.event === "item/completed");
    assert.ok(done, `No ${type} item completed.`);
    assert.equal(done.status, "completed", `The ${type} item ended ${done.status}: ${done.error ?? ""}`);
    assert.ok(done.savedPath && existsSync(done.savedPath), `The ${type} item has no file.`);
    const bytes = readFileSync(done.savedPath);
    const kind = signature(bytes);
    if (type === "videoGeneration") assert.equal(kind, "mp4", "The video is not an mp4 file.");
    else assert.ok(["png", "jpeg", "webp"].includes(kind), `The image is a ${kind} file.`);
    const copy = join(OUT, `${type}-${basename(done.savedPath)}`);
    copyFileSync(done.savedPath, copy);
    report.files.push({ type, copy, bytes: bytes.byteLength, signature: kind });
  }
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
} finally {
  await stopClients(clients);
  process.env = { ...saved };
  proxy.close();
  await rm(root, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
}

process.stdout.write(`${report.passed ? "Passed" : `Failed: ${report.error}`}\nReport: ${join(OUT, "report.json")}\n`);
process.exit(report.passed ? 0 : 1);
