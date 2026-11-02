// Runs real provider clients against owned stdio CLIs. No account or model request is used.
// bun scripts/provider-image-mime-e2e.ts
// Each image must reach the protocol child with its correct MIME type and unchanged bytes.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { EXPECTED_SCHEMA_FINGERPRINT } from "@muse-code/sdk";
import type { AgentClient } from "../src/backend/agent-client";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MuseAgentClient } from "../src/backend/muse-client";
import { PiAgentClient } from "../src/backend/pi-client";
import { type AppServerNotification, getString, isRecord } from "../src/backend/protocol";
import { requireProviderDriver } from "../src/backend/provider-drivers";

const out = resolve(import.meta.dirname, "../.openbot-build/provider-image-mime-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-image-mime-"));
const consumers = ["acp", "muse", "pi"] as const;
type Consumer = (typeof consumers)[number];

// Small complete images. FFmpeg made the 16 x 16 red JPEG and AVIF (SVT-AV1).
const fixtures = [
  {
    extensions: ["png"],
    mime: "image/png",
    data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=",
  },
  {
    extensions: ["jpg", "jpeg"],
    mime: "image/jpeg",
    data: "/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzYyLjI4LjEwMgD/2wBDAAgEBAQEBAUFBQUFBQYGBgYGBgYGBgYGBgYHBwcICAgHBwcGBgcHCAgICAkJCQgICAgJCQoKCgwMCwsODg4RERT/xABMAAEBAAAAAAAAAAAAAAAAAAAABgEBAQAAAAAAAAAAAAAAAAAABgcQAQAAAAAAAAAAAAAAAAAAAAARAQAAAAAAAAAAAAAAAAAAAAD/wAARCAAQABADASIAAhEAAxEA/9oADAMBAAIRAxEAPwCLAE1/f//Z",
  },
  { extensions: ["webp"], mime: "image/webp", data: "UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA" },
  { extensions: ["gif"], mime: "image/gif", data: "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" },
  {
    extensions: ["avif"],
    mime: "image/avif",
    data: "AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAAD5bWV0YQAAAAAAAAAvaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAFBpY3R1cmVIYW5kbGVyAAAAAA5waXRtAAAAAAABAAAAHmlsb2MAAAAARAAAAQABAAAAAQAAASEAAAAkAAAAKGlpbmYAAAAAAAEAAAAaaW5mZQIAAAAAAQAAYXYwMUNvbG9yAAAAAGppcHJwAAAAS2lwY28AAAAUaXNwZQAAAAAAAAAQAAAAEAAAABBwaXhpAAAAAAMICAgAAAAMYXYxQ4EADAAAAAATY29scm5jbHgAAgACAAIAAAAAF2lwbWEAAAAAAAAAAQABBAECgwQAAAAsbWRhdAoKAgAABUz/xq+QBDIWEACXgBBAggAAEABcEytNbG+TY8nR6A==",
  },
];

// These children implement only the protocol needed for a session and a completed turn.
// The real clients own spawning, SDK handshakes, encoding, dispatch, and process shutdown.
const childSource = String.raw`
const fs = require("node:fs");
const crypto = require("node:crypto");
const readline = require("node:readline");
const [mode, logPath, sessionFile, fingerprint] = process.argv.slice(2);
const log = (entry) => fs.appendFileSync(logPath, JSON.stringify({ pid: process.pid, ...entry }) + "\n");
const send = (frame) => process.stdout.write(JSON.stringify(frame) + "\n");
const notify = (method, params) => send({ jsonrpc: "2.0", method, params });
log({ event: "start", mode });
let sessions = 0;
let museSessionId;
const museItems = [];
const lines = readline.createInterface({ input: process.stdin });
lines.on("close", () => { log({ event: "stdin-closed" }); process.exit(0); });
lines.on("line", (line) => {
  const message = JSON.parse(line);
  const method = mode === "pi" ? message.type : message.method;
  const params = mode === "pi" ? message : message.params ?? {};
  log({ event: "request", method });
  const reply = (result) => mode === "pi"
    ? send({ type: "response", id: message.id, command: method, success: true, data: result })
    : send({ jsonrpc: "2.0", id: message.id, result });
  const reject = (reason) => send({ jsonrpc: "2.0", id: message.id,
    error: { code: -32602, message: reason, data: { kind: "invalidParams" } } });
  if (message.id === undefined) return;
  if (mode === "muse" && ["turn/start", "session/read"].includes(method) &&
      (!museSessionId || params.sessionId !== museSessionId)) return reject("Session mismatch");
  const prompt = (mode === "acp" && method === "session/prompt") ||
    (mode === "muse" && method === "turn/start") || (mode === "pi" && method === "prompt");
  if (prompt) {
    const blocks = mode === "acp" ? params.prompt : mode === "muse" ? params.input : params.images ?? [];
    log({ event: "prompt", method, images: blocks.filter((block) => block.type === "image").map((block) => {
      const bytes = Buffer.from(block.data ?? block.base64Data, "base64");
      return { mime: block.mimeType ?? block.mediaType, size: bytes.length,
        sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
    }) });
    if (mode === "acp") reply({ stopReason: "end_turn" });
    if (mode === "muse") {
      const turnId = params.commandId;
      if (typeof turnId !== "string" || museItems.some((item) => item.turnId === turnId)) {
        return reject("A new command ID is required");
      }
      const item = { itemId: turnId + "-reply", turnId, kind: "agentMessage",
        revision: 1, status: "completed", text: "OK" };
      museItems.push(item);
      reply({ commandId: turnId, status: "accepted", turnId, disposition: "started", startedNewTurn: true });
      notify("item/completed", { sessionId: museSessionId, item });
      notify("turn/completed", { sessionId: museSessionId, turnId, terminal: "completed" });
    }
    if (mode === "pi") reply({ disposition: "handled" });
    return;
  }
  if (mode === "acp" && method === "initialize") return reply({ protocolVersion: 1,
    agentInfo: { name: "image-fixture", version: "1" }, agentCapabilities: { promptCapabilities: { image: true } } });
  if (mode === "acp" && method === "session/new") return reply({ sessionId: "fixture-" + (++sessions) });
  if (mode === "muse" && method === "initialize") return reply({ experimentalApi: false,
    grantedCapabilities: ["sessionMcp"], museHome: process.cwd(), platformFamily: "unix", platformOs: "linux",
    schema: { version: 1, fingerprint }, serverInfo: { name: "image-fixture", version: "1" },
    sessionDurability: "durable", userAgent: "image-fixture" });
  if (mode === "muse" && method === "session/start") {
    museSessionId = params.sessionId;
    museItems.length = 0;
    return reply({ session: { sessionId: museSessionId } });
  }
  if (mode === "muse" && method === "session/read") {
    if (params.excludeItems !== false || museItems.length === 0) return reject("Completed history required");
    return reply({ session: { sessionId: museSessionId },
      history: { mode: "inline", items: museItems, snapshot: null },
      pendingRequests: [], viewCursor: String(museItems.length) });
  }
  if (mode === "pi" && method === "get_state") return reply({ sessionFile });
  if (mode === "pi" && method === "get_session_stats") return reply({
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } });
  if (mode === "pi" && ["switch_session", "set_model"].includes(method)) return reply({});
  // Fail setup on an unimplemented request, instead of treating it as a MIME failure.
  send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Fixture does not implement " + method } });
});
`;

interface CaseResult {
  name: string;
  expectedMime: string;
  expectedSha256: string;
  expectedSize: number;
  observedMime: string | null;
  observedSha256: string | null;
  observedSize: number | null;
  imageCount: number;
  completed: boolean;
  passed: boolean;
}
interface ConsumerResult {
  status: "NOT_RUN" | "PASS" | "MIME_MISMATCH" | "ERROR";
  reason?: string;
  cases: CaseResult[];
  traffic: object[];
  cleanup: { pid: number; stopped: boolean }[];
}
interface Report {
  passed: boolean;
  defect: string;
  networkModelRequests: boolean;
  sourceHashes: Record<string, string>;
  fixtureChildSha256: string;
  consumers: Record<Consumer, ConsumerResult>;
  errors: string[];
}
function notRun(): ConsumerResult {
  return { status: "NOT_RUN", reason: "Not started", cases: [], traffic: [], cleanup: [] };
}
const report: Report = {
  passed: false,
  defect: "Local image format preservation across provider consumers",
  networkModelRequests: false,
  sourceHashes: {},
  fixtureChildSha256: hash(Buffer.from(childSource)),
  consumers: { acp: notRun(), muse: notRun(), pi: notRun() },
  errors: [],
};

function hash(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function entries(path: string): Promise<object[]> {
  const content = await readFile(path, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  return content
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const value = JSON.parse(line);
      assert.ok(isRecord(value), "Child log entry must be an object.");
      return value;
    });
}

function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (isRecord(error) && error.code === "ESRCH") return false;
    throw error;
  }
}

/** Subscribe before the request. The deadline bounds failure; it is not a sleep. */
async function turn(client: AgentClient, threadId: string, path: string, model?: string): Promise<void> {
  let finish: () => void = () => {};
  let fail: (error: Error) => void = () => {};
  const done = new Promise<void>((resolveTurn, reject) => {
    finish = resolveTurn;
    fail = reject;
  });
  const timer = setTimeout(() => fail(new Error("Turn completion deadline expired.")), 15_000);
  const listener = (event: AppServerNotification) => {
    if (getString(event.params, "threadId") !== threadId) return;
    if (event.method === "error") fail(new Error("Provider reported a turn error."));
    if (event.method === "turn/completed") {
      const status = isRecord(event.params) ? getString(event.params.turn, "status") : null;
      if (status === "completed") finish();
      else fail(new Error(`Turn ended with status ${status}.`));
    }
  };
  const exited = (error: Error) => fail(error);
  client.on("notification", listener);
  client.once("exit", exited);
  try {
    await Promise.all([
      runCauseEffect(
        client.request(
          "turn/start",
          {
            threadId,
            ...(model ? { model } : {}),
            input: [
              { type: "text", text: "Inspect this local fixture." },
              { type: "localImage", path },
            ],
          },
          (value) => value,
        ),
      ),
      done,
    ]);
  } finally {
    clearTimeout(timer);
    client.off("notification", listener);
    client.off("exit", exited);
  }
}

try {
  await writeFile(join(root, "fixture.cjs"), childSource);
  for (const path of [
    "scripts/provider-image-mime-e2e.ts",
    "src/backend/acp-client.ts",
    "src/backend/acp-connection.ts",
    "src/backend/custom-acp-agents-client.ts",
    "src/backend/provider-drivers.ts",
    "src/backend/muse-client.ts",
    "src/backend/pi-client.ts",
    "src/backend/pi-messages.ts",
    "src/backend/pi-rpc.ts",
    "node_modules/@agentclientprotocol/sdk/dist/acp.js",
    "node_modules/@agentclientprotocol/sdk/dist/stream.js",
    "node_modules/@muse-code/sdk/dist/src/connection/spawn.js",
    "node_modules/@muse-code/sdk/dist/src/connection/connection.js",
  ])
    report.sourceHashes[path] = hash(await readFile(resolve(import.meta.dirname, "..", path)));

  for (const consumer of consumers) {
    const result = report.consumers[consumer];
    const log = join(root, `${consumer}.jsonl`);
    const executable = join(root, `${consumer}-fixture`);
    let client: AgentClient | undefined;
    try {
      const args = [
        process.execPath,
        join(root, "fixture.cjs"),
        consumer,
        log,
        join(root, "pi-session.jsonl"),
        EXPECTED_SCHEMA_FINGERPRINT,
      ];
      await writeFile(executable, `#!/bin/sh\nexec ${args.map(shellQuote).join(" ")}\n`);
      await chmod(executable, 0o700);
      const cli = { executable, version: "fixture" };
      if (consumer === "acp") {
        const driver = requireProviderDriver("acp");
        client = driver.createClient(
          cli,
          15_000,
          {
            apiKey: () => null,
            customProviders: () => [],
            mcpServers: () => [],
            customAgents: () => [
              { id: "image-fixture", name: "Image fixture", command: executable, args: [], env: [], usagePrompt: null },
            ],
          },
          undefined,
        );
      } else if (consumer === "muse") {
        client = new MuseAgentClient(cli, { apiKey: () => null, env: {}, requestTimeoutMs: 15_000 });
      } else {
        client = new PiAgentClient(cli, { requestTimeoutMs: 15_000, providerStateDirectory: root });
      }
      client.start();
      const model = consumer === "acp" ? "image-fixture/default" : undefined;
      const opened = await runCauseEffect(
        client.request(
          "thread/start",
          {
            cwd: root,
            ...(model ? { model } : {}),
          },
          (value) => value,
        ),
      );
      const threadId = isRecord(opened) ? getString(opened.thread, "id") : null;
      assert.ok(threadId, "thread/start must return an id.");
      for (const fixture of fixtures) {
        const bytes = Buffer.from(fixture.data, "base64");
        for (const extension of fixture.extensions) {
          for (const variant of [
            extension,
            extension.toUpperCase(),
            extension[0]?.toUpperCase() + extension.slice(1),
          ]) {
            const path = join(root, `image.${variant}`);
            await writeFile(path, bytes);
            await turn(client, threadId, path, model);
            const prompts = (await entries(log)).filter((entry) => getString(entry, "event") === "prompt");
            assert.equal(prompts.length, result.cases.length + 1, "Each turn must reach the protocol child once.");
            const prompt = prompts.at(-1);
            const images = isRecord(prompt) && Array.isArray(prompt.images) ? prompt.images : [];
            const image = images[0];
            const observedSize = isRecord(image) && typeof image.size === "number" ? image.size : null;
            const observedMime = getString(image, "mime");
            const observedSha256 = getString(image, "sha256");
            result.cases.push({
              name: variant,
              expectedMime: fixture.mime,
              expectedSha256: hash(bytes),
              expectedSize: bytes.length,
              observedMime,
              observedSha256,
              observedSize,
              imageCount: images.length,
              completed: true,
              passed:
                images.length === 1 &&
                observedMime === fixture.mime &&
                observedSha256 === hash(bytes) &&
                observedSize === bytes.length,
            });
          }
        }
      }
      const dataFailure = result.cases.some(
        (item) =>
          item.imageCount !== 1 ||
          item.observedSha256 !== item.expectedSha256 ||
          item.observedSize !== item.expectedSize,
      );
      result.status = dataFailure ? "ERROR" : result.cases.every((item) => item.passed) ? "PASS" : "MIME_MISMATCH";
      delete result.reason;
    } catch (error) {
      result.status = result.cases.length ? "ERROR" : "NOT_RUN";
      result.reason = error instanceof Error ? error.message : String(error);
    } finally {
      try {
        if (client) await runCauseEffect(client.stop());
      } catch (error) {
        result.status = "ERROR";
        result.reason = `Child shutdown failed: ${String(error)}`;
      }
      result.traffic = await entries(log);
      const pids = new Set(
        result.traffic.flatMap((entry) =>
          isRecord(entry) && entry.event === "start" && typeof entry.pid === "number" ? [entry.pid] : [],
        ),
      );
      result.cleanup = [...pids].map((pid) => ({ pid, stopped: !running(pid) }));
      if (result.cleanup.some((child) => !child.stopped)) {
        result.status = "ERROR";
        result.reason = `${result.reason ?? ""} Owned child cleanup was not confirmed.`.trim();
      }
    }
  }
} catch (error) {
  report.errors.push(error instanceof Error ? error.message : String(error));
} finally {
  report.passed =
    report.errors.length === 0 && consumers.every((consumer) => report.consumers[consumer].status === "PASS");
  if (consumers.every((consumer) => report.consumers[consumer].cleanup.every((child) => child.stopped))) {
    await rm(root, { recursive: true, force: true });
  }
  await mkdir(out, { recursive: true });
  await writeFile(join(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(
    `${JSON.stringify({
      passed: report.passed,
      report: join(out, "report.json"),
      consumers: Object.fromEntries(consumers.map((consumer) => [consumer, report.consumers[consumer].status])),
    })}\n`,
  );
  process.exitCode = report.passed
    ? 0
    : consumers.some(
          (consumer) =>
            report.consumers[consumer].status === "ERROR" || report.consumers[consumer].status === "NOT_RUN",
        ) || report.errors.length
      ? 2
      : 1;
}
