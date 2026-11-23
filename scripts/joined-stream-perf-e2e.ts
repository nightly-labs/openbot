import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { translateFor } from "@openbot/i18n";
import { createOpenBotLogger } from "@openbot/logging";
import { chromium, type Page } from "playwright-core";
import { argument, WAIT_MS } from "./channel-e2e-support";
import { type FakeCodexCorpus, writeFakeCodex } from "./dev-automation/bench-fake-codex";
import type { MetricValues } from "./dev-automation/bench-stats";
import { assertMutationAllowed, connectToDevApp } from "./dev-automation/cdp-client";
import {
  type DevInstanceRecord,
  type DevInstanceService,
  readDevInstanceRecords,
} from "./dev-automation/instance-registry";
import { startRenderRecording } from "./dev-automation/render-metrics";

const NAME = "joined-stream-perf";
const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(ROOT, ".openbot-build", NAME);
const FAKE_CODEX_DIRECTORY = join(OUT, "fake-codex");
const FAKE_LOG = join(FAKE_CODEX_DIRECTORY, "codex.jsonl");
const DEV_HOST_EMAIL = "openbot-dev-host@example.com";
const SELECTED_SERVER_PREFIX = "openbot.web.selected-server:";
const CONVERSATION = ".conversation-scroll";
const CODEX_MODEL = "gpt-5.5";
const PROMPT = "Reply with a long answer. Do not use tools.";
const POLL_MS = 250;
const english = translateFor("en");
const logger = createOpenBotLogger(NAME);

const prepare = process.argv.includes("--prepare");
const allowMutations = process.argv.includes("--allow-mutations");
const api = (argument("api") ?? "http://localhost:3100").replace(/\/$/, "");
const agentId = argument("agent") ?? "chief";
const serverIdArgument = argument("server-id");
const webHostId = argument("host-id");
const browserExecutable = argument("browser-executable");
const deltas = Number(argument("deltas") ?? "400");
assert.ok(Number.isInteger(deltas) && deltas >= 1, "--deltas takes a whole number, 1 or more.");
const deltaMs = Number(argument("delta-ms") ?? "10");
assert.ok(Number.isInteger(deltaMs) && deltaMs >= 0, "--delta-ms takes a whole number of milliseconds.");
const corpusArgument = argument("corpus") ?? "words";
assert.ok(corpusArgument === "words" || corpusArgument === "markdown", "--corpus takes words or markdown.");
const corpus: FakeCodexCorpus = corpusArgument;

interface FakeTurn {
  status: string;
  characters: number;
  trimmedCharacters: number;
  deltas: number;
}

interface Reply {
  completed: boolean;
  characters: number;
}

interface SurfaceResult {
  surface: "web" | "test-client";
  metrics: MetricValues;
  probes: unknown;
  probesPresent: boolean;
  visibleTextCharacters: number;
  reply: Reply | null;
}

const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const json = (value: unknown) => JSON.stringify(value);
const delay = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

async function poll<T>(what: string, read: () => Promise<T | null> | T | null): Promise<T> {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const value = await read();
    if (value !== null) return value;
    if (Date.now() > deadline) throw new Error(`Timed out: ${what}.`);
    await delay(POLL_MS);
  }
}

function fakeTurns(): FakeTurn[] {
  const text = existsSync(FAKE_LOG) ? readFileSync(FAKE_LOG, "utf8") : "";
  const turns: FakeTurn[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const entry = JSON.parse(line);
    if (!isDynamicRecord(entry) || !isString(entry.turnEnded)) continue;
    turns.push({
      status: isString(entry.status) ? entry.status : "",
      characters: isNumber(entry.characters) ? entry.characters : -1,
      trimmedCharacters: isNumber(entry.trimmedCharacters) ? entry.trimmedCharacters : -1,
      deltas: isNumber(entry.deltas) ? entry.deltas : 0,
    });
  }
  return turns;
}

function instance(service: DevInstanceService): DevInstanceRecord {
  const matches = readDevInstanceRecords().filter(
    (record) => record.service === service && resolve(record.projectRoot) === ROOT,
  );
  assert.equal(
    matches.length,
    1,
    `This worktree needs exactly one running "${service}" instance. Run this script with --prepare for the start command.`,
  );
  const [record] = matches;
  assert.ok(record);
  return record;
}

function toReply(value: unknown): Reply | null {
  if (!isDynamicRecord(value) || typeof value.completed !== "boolean" || !isNumber(value.characters)) return null;
  return { completed: value.completed, characters: value.characters };
}

async function lastReply(page: Page, serverId: string | null): Promise<Reply | null> {
  const serverArgument = serverId === null ? "" : `, ${json(serverId)}`;
  const value = await page.evaluate(`window.openbot.agent
    .readConversationPage({ agentId: ${json(agentId)}, limit: 1 }${serverArgument})
    .then((page) => {
      const last = page.messages[page.messages.length - 1];
      const reply = last && last.source !== "user" ? last : null;
      return { completed: reply?.status === "completed", characters: reply?.text.length ?? 0 };
    })`);
  return toReply(value);
}

async function useFakeCodex(host: Page): Promise<void> {
  const chosen = await poll(`the host lists the ${CODEX_MODEL} Codex model`, async () => {
    const models = await host.evaluate("window.openbot.agent.listModels()");
    if (!Array.isArray(models)) return null;
    const model = models.find(
      (entry) => isDynamicRecord(entry) && entry.provider === "codex" && entry.id === CODEX_MODEL,
    );
    return isDynamicRecord(model) ? model : null;
  });
  const efforts = Array.isArray(chosen.supportedReasoningEfforts) ? chosen.supportedReasoningEfforts : [];
  const reasoningEffort = efforts.includes("low")
    ? "low"
    : isString(chosen.defaultReasoningEffort)
      ? chosen.defaultReasoningEffort
      : "low";
  await host.evaluate(
    `window.openbot.agent.updateAgent(${json({ agentId, provider: "codex", model: CODEX_MODEL, reasoningEffort })}).then(() => null)`,
  );
}

async function joinedServerId(testClient: Page): Promise<string> {
  if (serverIdArgument) return serverIdArgument;
  const servers = await testClient.evaluate("window.openbot.servers.list()");
  assert.ok(Array.isArray(servers), "The test client returned no server list.");
  const remote = servers.filter((server) => isDynamicRecord(server) && server.kind === "remote");
  assert.equal(remote.length, 1, `The test client has ${remote.length} joined servers. Name one with --server-id.`);
  const [server] = remote;
  assert.ok(isDynamicRecord(server) && isString(server.id));
  return server.id;
}

async function signIn(page: Page): Promise<void> {
  await page.goto(`${api}/app`);
  await page.getByRole("textbox", { name: english("account.login.email"), exact: true }).fill(DEV_HOST_EMAIL);
  const send = page.getByRole("button", { name: english("account.login.sendCode"), exact: true });
  const prefix = english("account.login.developmentCode", { code: "" });
  const notice = page.getByText(new RegExp(`^${literal(prefix)}`));
  const deadline = Date.now() + WAIT_MS;
  await send.click();
  while (!(await notice.isVisible()) && Date.now() < deadline) {
    await notice.waitFor({ timeout: 5_000 }).catch(() => undefined);
    if (!(await notice.isVisible()) && (await send.isVisible()) && (await send.isEnabled())) await send.click();
  }
  await notice.waitFor({ timeout: 1_000 });
  const code = (await notice.innerText()).slice(prefix.length).replaceAll("-", "").trim();
  assert.ok(code.length > 0, "The account service showed no development code.");
  await page.keyboard.type(code);
  if (!webHostId) return;
  await page.waitForFunction(
    (keyPrefix) => Object.keys(localStorage).some((key) => key.startsWith(keyPrefix)),
    SELECTED_SERVER_PREFIX,
    { timeout: WAIT_MS, polling: POLL_MS },
  );
  await page.evaluate(
    ({ keyPrefix, id }) => {
      for (const key of Object.keys(localStorage)) if (key.startsWith(keyPrefix)) localStorage.setItem(key, id);
    },
    { keyPrefix: SELECTED_SERVER_PREFIX, id: webHostId },
  );
  await page.reload();
}

async function openAgent(page: Page, surface: string): Promise<void> {
  const row = page.locator(`[data-chat-id="${agentId}"] button`).first();
  await row.waitFor({ timeout: WAIT_MS }).catch((error: unknown) => {
    throw new Error(`${surface}: no sidebar row for the agent "${agentId}".`, { cause: error });
  });
  await row.click();
  await page.locator(CONVERSATION).first().waitFor({ timeout: WAIT_MS });
}

function visibleText(page: Page): Promise<number> {
  return page.evaluate((selector) => document.querySelector(selector)?.textContent?.length ?? 0, CONVERSATION);
}

async function settledText(page: Page): Promise<number> {
  let previous = -1;
  let streak = 0;
  return poll("the conversation text stops changing", async () => {
    const length = await visibleText(page);
    streak = length === previous ? streak + 1 : 0;
    previous = length;
    return streak >= 3 ? length : null;
  });
}

interface Recording {
  surface: SurfaceResult["surface"];
  page: Page;
  stop: Awaited<ReturnType<typeof startRenderRecording>>;
  probesPresent: boolean;
}

async function startRecording(surface: Recording["surface"], page: Page): Promise<Recording> {
  const stop = await startRenderRecording(page, { frames: false, callCounts: false });
  const probesPresent = await page.evaluate(
    "typeof window.__openbotPerfProbes?.start === 'function' ? (window.__openbotPerfProbes.start(), true) : false",
  );
  return { surface, page, stop, probesPresent: probesPresent === true };
}

async function finishRecording(recording: Recording, reply: Reply | null): Promise<SurfaceResult> {
  const visibleTextCharacters = await settledText(recording.page);
  const probes = recording.probesPresent ? await recording.page.evaluate("window.__openbotPerfProbes.stop()") : null;
  const { values } = await recording.stop();
  return {
    surface: recording.surface,
    metrics: values,
    probes,
    probesPresent: recording.probesPresent,
    visibleTextCharacters,
    reply,
  };
}

async function writePrepared(): Promise<void> {
  const codex = await writeFakeCodex(FAKE_CODEX_DIRECTORY, { deltaMs, deltas, corpus });
  const assignments = Object.entries(codex.environment)
    .map(([key, value]) => `${key}=${json(value)}`)
    .join(" ");
  logger.info(
    [
      `The fake Codex is in ${FAKE_CODEX_DIRECTORY}.`,
      "Stop this worktree's dev stack (bun run dev:stop), then start it with the fake Codex:",
      `  env ${assignments} bun run dev:test-client`,
      "Then run:",
      "  bun scripts/joined-stream-perf-e2e.ts --allow-mutations",
    ].join("\n"),
  );
}

async function run(): Promise<void> {
  assert.ok(existsSync(FAKE_LOG), "The fake Codex is missing. Run this script with --prepare first.");
  const hostInstance = instance("app");
  const clientInstance = instance("test-client");
  assertMutationAllowed({
    command: "perf:joined-stream changes the agent model and sends a message",
    allowMutations,
    instanceNamed: true,
    target: hostInstance.instanceId,
  });
  const host = await connectToDevApp(hostInstance.remoteDebuggingPort, logger, {
    expectedRendererPort: hostInstance.rendererPort,
    ownerPid: hostInstance.pid,
  });
  const client = await connectToDevApp(clientInstance.remoteDebuggingPort, logger, {
    expectedRendererPort: clientInstance.rendererPort,
    ownerPid: clientInstance.pid,
  });
  const browser = await chromium.launch(
    browserExecutable ? { executablePath: browserExecutable } : { channel: "chrome" },
  );
  try {
    await useFakeCodex(host.page);
    const serverId = await joinedServerId(client.page);
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const web = await context.newPage();
    await signIn(web);
    await openAgent(web, "web");
    await openAgent(client.page, "test-client");
    const turnsBefore = fakeTurns().length;
    const recordings = [await startRecording("web", web), await startRecording("test-client", client.page)];
    const started = Date.now();
    await host.page.evaluate(`window.openbot.agent.sendMessage(${json({ agentId, text: PROMPT })}).then(() => null)`);
    const turn = await poll("the fake Codex ends the turn", () => fakeTurns()[turnsBefore] ?? null);
    assert.equal(turn.status, "completed", `The fake Codex ended the turn as "${turn.status}".`);
    const accepted = new Set([turn.characters, turn.trimmedCharacters]);
    const hostReply = await poll("the host saves the completed reply", async () => {
      const reply = await lastReply(host.page, null);
      return reply?.completed ? reply : null;
    });
    const clientReply = await poll("the test client reads the completed reply", async () => {
      const reply = await lastReply(client.page, serverId);
      return reply?.completed ? reply : null;
    });
    const streamMs = Date.now() - started;
    const surfaces: SurfaceResult[] = [];
    for (const recording of recordings)
      surfaces.push(await finishRecording(recording, recording.surface === "test-client" ? clientReply : null));
    const failures: string[] = [];
    if (!accepted.has(hostReply.characters))
      failures.push(`Host reply has ${hostReply.characters} characters, the fake log has ${turn.characters}.`);
    if (!accepted.has(clientReply.characters))
      failures.push(`Test client reply has ${clientReply.characters} characters, the fake log has ${turn.characters}.`);
    const report = {
      generatedAt: new Date().toISOString(),
      method:
        "Counts only. CDP Performance.getMetrics deltas and longtasks per page, from before the send until the reply is complete and the conversation text is stable. Probes come from window.__openbotPerfProbes when the page has them.",
      options: { agentId, deltas, deltaMs, corpus, model: CODEX_MODEL, api },
      fakeTurn: turn,
      streamMs,
      host: { reply: hostReply },
      surfaces,
      failures,
    };
    mkdirSync(OUT, { recursive: true });
    const stamp = report.generatedAt.replaceAll(":", "-");
    writeFileSync(join(OUT, `report-${stamp}.json`), `${JSON.stringify(report, null, 2)}\n`);
    writeFileSync(join(OUT, "latest.json"), `${JSON.stringify(report, null, 2)}\n`);
    const lines = surfaces.map(
      (surface) =>
        `${surface.surface}: ${Object.entries(surface.metrics)
          .map(([key, value]) => `${key}=${value}`)
          .join(" ")} probes=${surface.probesPresent ? "yes" : "no"}`,
    );
    logger.info(`${join(OUT, "latest.json")}\nfake reply: ${turn.characters} characters\n${lines.join("\n")}`);
    if (failures.length > 0) {
      process.stderr.write(`${failures.join("\n")}\n`);
      process.exitCode = 1;
    }
    await context.close();
  } finally {
    await browser.close();
    await client.close();
    await host.close();
  }
}

if (prepare) await writePrepared();
else await run();
