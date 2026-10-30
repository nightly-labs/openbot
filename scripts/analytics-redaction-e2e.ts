// Seeds one random marker into everything a user can type that analytics could read: a custom
// agent's id, name, arguments and secret environment value, an agent's name and messages, a
// routine's name and instruction, an MCP server's address, headers and command, and the address of
// a browser page, and a workflow's title and texts. It then runs agent turns, a failed turn, a
// routine run, a workflow run and site visits in a running dev app, receives the analytics of main
// and the window on a local capture server, and checks that
// no request carries the marker, that the expected events arrived, and that turning analytics off
// stops them. The turns run on a fake custom agent on this computer, so no model is used. The fake
// agent reports token usage for each answered turn, and the script checks that the turn event carries
// those counts, the same counts as the Usage report, that the model's own token event carries them,
// that the turn says how it is paid for,
// that a turn with no usage reports unknown, and that the failed turn's failure report arrives.
//
// Start the dev app with the capture server's address first, then run the script:
//   OPENBOT_ANALYTICS_CAPTURE_URL=http://localhost:47321 bun run dev
//   bun scripts/analytics-redaction-e2e.ts --allow-mutations [--capture-port=47321]
// The script removes what it added and restores the analytics setting. It writes
// .openbot-build/analytics-redaction-e2e/report.json and needs internet access for one page.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { LOCAL_SERVER_ID, type OpenBotDesktopApi } from "@openbot/contracts/ipc";
import { createOpenBotLogger } from "@openbot/logging";
import type { Page } from "playwright-core";
import { z } from "zod";
import { assertMutationAllowed, connectToDevApp } from "./dev-automation/cdp-client";
import { readDevInstanceRecords } from "./dev-automation/instance-registry";

// The page functions below run in the app window, where the preload bridge sets this.
declare global {
  interface Window {
    openbot: OpenBotDesktopApi;
  }
}

const OUT = resolve(import.meta.dirname, "../.openbot-build/analytics-redaction-e2e");
const portFlag = process.argv.find((argument) => argument.startsWith("--capture-port="));
const CAPTURE_PORT = Number(portFlag?.slice("--capture-port=".length) ?? 47321);
const CAPTURE_URL = `http://localhost:${CAPTURE_PORT}`;
/** Lower-case letters and digits only, so every encoding of it still contains it. */
const MARKER = `obe2e${randomBytes(6).toString("hex")}`;
const EVENT_TIMEOUT_MS = 60_000;

// A custom agent that speaks the Agent Client Protocol on stdio. When a message asks it to fail, it
// prints its secret token to stderr and in the error of the prompt, the way a CLI that refuses a
// credential does. An answered prompt reports ACP usage, which is cumulative for the session.
const FAKE_AGENT = `#!/usr/bin/env node
const NL = String.fromCharCode(10);
const prompts = new Map();
let buffer = "";
const write = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + NL);
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf(NL)) >= 0) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    if (line.trim()) handle(JSON.parse(line));
  }
});
function handle(message) {
  if (message.id === undefined) return;
  if (message.method === "initialize") {
    write({ id: message.id, result: { protocolVersion: 1, agentInfo: { name: process.env.FAKE_TOKEN, version: "1.0.0" }, agentCapabilities: {} } });
    return;
  }
  if (message.method === "session/new") {
    write({ id: message.id, result: { sessionId: "session-" + process.env.FAKE_TOKEN } });
    return;
  }
  if (message.method === "session/prompt") {
    const text = message.params.prompt.filter((block) => block.type === "text").map((block) => block.text).join(" ");
    if (text.includes("please fail")) {
      process.stderr.write("fatal: token " + process.env.FAKE_TOKEN + " refused" + NL);
      write({ id: message.id, error: { code: -32603, message: "Authentication failed: token " + process.env.FAKE_TOKEN + " refused" } });
      return;
    }
    write({ method: "session/update", params: { sessionId: message.params.sessionId, update: {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "Done with " + process.env.FAKE_TOKEN },
    } } });
    const count = (prompts.get(message.params.sessionId) ?? 0) + 1;
    prompts.set(message.params.sessionId, count);
    const usage = { inputTokens: 1500 * count, cachedReadTokens: 1000 * count, cachedWriteTokens: 200 * count, outputTokens: 50 * count, totalTokens: 1550 * count };
    write({ id: message.id, result: { stopReason: "end_turn", usage } });
    return;
  }
  write({ id: message.id, result: {} });
}
setInterval(() => {}, 1000);
`;

/**
 * The body that the OpenPanel SDK and the failure report transport post. It comes from `JSON.parse`,
 * so every value is JSON. `z.json()` in a record makes TypeScript 7.1 report TS5115.
 */
const openPanelBody = z.object({
  type: z.string(),
  payload: z.object({ name: z.string().optional(), properties: z.record(z.string(), z.unknown()).optional() }),
});

interface Captured {
  method: string;
  url: string;
  /** The request headers, as JSON text, for the leak scan. */
  headers: string;
  body: string;
  /** The event name of a `track` body, or the body type. */
  name: string | null;
  properties: z.infer<typeof openPanelBody>["payload"]["properties"] & {};
}

const captured: Captured[] = [];

function readEvent(body: string): Pick<Captured, "name" | "properties"> {
  const parsed = openPanelBody.safeParse(body ? JSON.parse(body) : null);
  if (!parsed.success) return { name: null, properties: {} };
  const { type, payload } = parsed.data;
  return { name: type === "track" ? (payload.name ?? null) : type, properties: payload.properties ?? {} };
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "POST, OPTIONS",
};
async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

/** `localhost` can resolve to either loopback address, so a server listens on both and on no other. */
async function listenOnLoopback(port: number, server: () => Server): Promise<{ port: number; servers: Server[] }> {
  const servers: Server[] = [];
  let bound = port;
  for (const host of ["127.0.0.1", "::1"]) {
    const instance = server();
    await new Promise<void>((done, fail) => {
      instance.once("error", fail);
      instance.listen(bound, host, () => done());
    });
    const address = instance.address();
    if (address !== null && typeof address === "object") bound = address.port;
    servers.push(instance);
  }
  return { port: bound, servers };
}

const capture = await listenOnLoopback(CAPTURE_PORT, () =>
  createServer((request, response) => {
    if (request.method === "OPTIONS") {
      response.writeHead(204, CORS).end();
      return;
    }
    void readBody(request).then((body) => {
      const headers = JSON.stringify(request.headers);
      captured.push({ method: request.method ?? "", url: request.url ?? "", headers, body, ...readEvent(body) });
      response.writeHead(200, { ...CORS, "content-type": "application/json" }).end("{}");
    });
  }),
);
// A page on a local host. Analytics must not name a private or local host.
const localPage = await listenOnLoopback(0, () =>
  createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" }).end("<title>Local page</title><p>Local page</p>");
  }),
);

async function waitForEvent(
  name: string,
  match: (event: Captured) => boolean = () => true,
  timeoutMs = EVENT_TIMEOUT_MS,
): Promise<Captured> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const event = captured.find((entry) => entry.name === name && match(entry));
    if (event) return event;
    if (Date.now() > deadline) throw new Error(`No ${name} event arrived in ${timeoutMs} ms.`);
    await sleep(250);
  }
}

const instances = readDevInstanceRecords().filter(
  (record) => record.service === "app" && resolve(record.projectRoot) === resolve(process.cwd()),
);
assert.equal(instances.length, 1, "Start one dev app for this worktree first.");
const instance = instances[0];
assert.ok(instance);
assertMutationAllowed({
  command: "analytics-redaction-e2e",
  allowMutations: process.argv.includes("--allow-mutations"),
  instanceNamed: true,
  target: instance.instanceId,
});
const logger = createOpenBotLogger("analytics-redaction-e2e");
const session = await connectToDevApp(instance.remoteDebuggingPort, logger, {
  expectedRendererPort: instance.rendererPort,
  ownerPid: instance.pid,
});
const page: Page = session.page;

const appInfo = await page.evaluate(() => window.openbot.getAppInfo());
assert.equal(
  appInfo.analyticsCaptureUrl,
  CAPTURE_URL,
  `Start the dev app with OPENBOT_ANALYTICS_CAPTURE_URL=${CAPTURE_URL}.`,
);

// The renderer reports `desktop_app_opened` once per load. Load the window again, so that the
// renderer send path is checked too, and not only the host's.
await page.reload();
await page.waitForFunction(() => document.readyState === "complete");

const fakeDirectory = mkdtempSync(join(tmpdir(), "openbot-analytics-e2e-"));
const fakeAgentPath = join(fakeDirectory, "fake-acp-agent");
writeFileSync(fakeAgentPath, FAKE_AGENT);
chmodSync(fakeAgentPath, 0o755);

const customAgentId = MARKER;
const results: { name: string; passed: boolean; detail?: unknown }[] = [];
const cleanup: (() => Promise<unknown>)[] = [];
const trackingBefore = await page.evaluate(() => window.openbot.getAnalyticsPreference());

function check(name: string, passed: boolean, detail?: unknown) {
  results.push({ name, passed, ...(detail === undefined ? {} : { detail }) });
}

try {
  if (!trackingBefore.enabled) await page.evaluate(() => window.openbot.setAnalyticsPreference({ enabled: true }));

  // An MCP server whose address, header, command and environment all carry the marker.
  const mcpServers = await page.evaluate(
    ({ marker, server }) =>
      window.openbot.agent.saveMcpServer(
        {
          config: {
            id: "",
            name: `e2e_${marker}`,
            transport: "http",
            enabled: true,
            command: "",
            args: [],
            env: [{ key: "E2E_TOKEN", value: `${marker}env` }],
            envPassthrough: [],
            workingDirectory: "",
            url: `http://user:${marker}pw@127.0.0.1:9/mcp?token=${marker}query`,
            headers: [{ key: "Authorization", value: `Bearer ${marker}header` }],
          },
        },
        server,
      ),
    { marker: MARKER, server: LOCAL_SERVER_ID },
  );
  const mcpServerId = mcpServers.find((server) => server.name === `e2e_${MARKER}`)?.id;
  assert.ok(mcpServerId, "The saved MCP server is not in the list.");
  cleanup.push(() =>
    page.evaluate(({ id, server }) => window.openbot.agent.removeMcpServer({ mcpServerId: id }, server), {
      id: mcpServerId,
      server: LOCAL_SERVER_ID,
    }),
  );

  await page.evaluate(
    ({ id, command, marker }) =>
      window.openbot.customAgents.save({
        id,
        name: `Agent ${marker}`,
        command,
        args: [`--token=${marker}arg`],
        env: [{ name: "FAKE_TOKEN", value: `${marker}token` }],
        usagePrompt: null,
      }),
    { id: customAgentId, command: fakeAgentPath, marker: MARKER },
  );
  cleanup.push(() => page.evaluate((id) => window.openbot.customAgents.delete({ id }), customAgentId));

  // A saved custom agent restarts the provider. Until the restarted process has listed its models,
  // the host refuses the model with "listed no models"; that refusal is the state to wait out.
  const createAgent = async (label: string, message: string) => {
    const deadline = Date.now() + EVENT_TIMEOUT_MS;
    for (;;) {
      try {
        return await page.evaluate(
          ({ customId, marker, label, message }) =>
            window.openbot.agent.createAgent({
              name: `${label} ${marker}`,
              description: `Description ${marker}`,
              avatarSeed: marker,
              avatarHue: null,
              initialMessage: `${message} ${marker}`,
              provider: "acp",
              model: `${customId}/default`,
            }),
          { customId: customAgentId, marker: MARKER, label, message },
        );
      } catch (error) {
        const notListed = error instanceof Error && error.message.includes("listed no models");
        if (!notListed || Date.now() > deadline) throw error;
        await sleep(250);
      }
    }
  };
  const opened = await waitForEvent("desktop_app_opened");
  check("the renderer reports that the app opened", opened.properties.surface === "desktop", opened.properties);

  const agent = await createAgent("Answers", "Say hello to");
  cleanup.push(() => page.evaluate((id) => window.openbot.agent.deleteAgent(id), agent.id));
  const completed = await waitForEvent("system_turn_completed", (event) => event.properties.provider === "acp");
  check("a custom agent's turn is reported", true, completed.properties);
  check("a custom agent's model is reported as its kind only", completed.properties.model === "custom", {
    model: completed.properties.model,
  });
  // A custom ACP agent's payment is not known to the host, so it reports `unknown`, never a guess.
  check("a turn reports how it is paid for", completed.properties.provider_auth === "unknown", {
    provider_auth: completed.properties.provider_auth,
  });
  // The fake agent reports 1,500 input tokens, of which 1,000 are cache reads and 200 cache writes.
  const expectedTokens = {
    token_usage: "reported",
    uncached_input_tokens: 300,
    cached_input_tokens: 1000,
    cache_write_tokens: 200,
    output_tokens: 50,
    total_tokens: 1550,
  };
  const tokenProperties = Object.fromEntries(
    Object.keys(expectedTokens).map((key) => [key, completed.properties[key]]),
  );
  check(
    "a turn reports the provider's token counts",
    JSON.stringify(tokenProperties) === JSON.stringify(expectedTokens),
    tokenProperties,
  );
  const usageReport = await page.evaluate(
    async ({ agentId, server }) => {
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const today = new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
      return window.openbot.agent.getHostAnalytics({ startDate: today, endDate: today, timeZone, agentId }, server);
    },
    { agentId: agent.id, server: LOCAL_SERVER_ID },
  );
  const reportTokens = usageReport && {
    uncached_input_tokens: usageReport.totals.uncachedInput,
    cached_input_tokens: usageReport.totals.cachedInput,
    cache_write_tokens: usageReport.totals.cacheCreation,
    output_tokens: usageReport.totals.output,
    total_tokens: usageReport.totals.processedTokens,
  };
  check(
    "the turn's token counts match the Usage report",
    reportTokens !== null && Object.entries(reportTokens).every(([key, value]) => tokenProperties[key] === value),
    { event: tokenProperties, report: reportTokens },
  );
  const modelUsage = await waitForEvent("system_token_usage", (event) => event.properties.provider === "acp");
  const modelTokens = Object.fromEntries(Object.keys(expectedTokens).map((key) => [key, modelUsage.properties[key]]));
  check(
    "the turn's model reports its own token counts",
    modelUsage.properties.model === "custom" && JSON.stringify(modelTokens) === JSON.stringify(expectedTokens),
    modelUsage.properties,
  );

  const failing = await createAgent("Fails", "Now please fail, with");
  cleanup.push(() => page.evaluate((id) => window.openbot.agent.deleteAgent(id), failing.id));
  const failure = await waitForEvent(
    "system_turn_completed",
    (event) => event.properties.provider === "acp" && event.properties.status === "failed",
  );
  check("a failed turn is reported", true, failure.properties);
  // Before the shared generation list, `safeReport` refused the host's generation, so no report arrived.
  const report = await waitForEvent("system_operation_failed", (event) => event.properties.source === "host").catch(
    () => null,
  );
  check("the failed turn's failure report arrives", report !== null, report?.properties);
  check(
    "a turn with no provider usage reports unknown, not 0",
    failure.properties.token_usage === "unknown" &&
      !Object.keys(failure.properties).some((key) => key.endsWith("_tokens")),
    failure.properties,
  );

  const routine = await page.evaluate(
    ({ agentId, marker }) =>
      window.openbot.agent.createRoutine({
        agentId,
        name: `Routine ${marker}`,
        instruction: `Report on ${marker}`,
        active: false,
        timezone: "UTC",
        schedule: { kind: "daily", time: "09:00" },
      }),
    { agentId: agent.id, marker: MARKER },
  );
  await page.evaluate(({ agentId, routineId }) => window.openbot.agent.testRoutine({ agentId, routineId }), {
    agentId: agent.id,
    routineId: routine.id,
  });
  const routineRun = await waitForEvent("system_routine_run");
  check("a routine run is reported", true, routineRun.properties);

  // A prompt into a step of the answering agent: the run sends the agent the marker.
  const workflow = await page.evaluate(
    ({ agentId, marker, server }) =>
      window.openbot.workflows.create(
        {
          title: `Workflow ${marker}`,
          graph: {
            nodes: [
              { id: "prompt", kind: "prompt", at: { x: 0, y: 0 }, fields: { text: `Say hello to ${marker}` } },
              { id: "agent", kind: "agent", at: { x: 300, y: 0 }, fields: { agentId, task: `Greet ${marker}` } },
            ],
            edges: [{ id: "edge", from: "prompt", to: "agent", type: "text" }],
            strokes: [],
          },
        },
        server,
      ),
    { agentId: agent.id, marker: MARKER, server: LOCAL_SERVER_ID },
  );
  cleanup.push(() =>
    page.evaluate(({ id, server }) => window.openbot.workflows.delete(id, server), {
      id: workflow.summary.id,
      server: LOCAL_SERVER_ID,
    }),
  );
  await page.evaluate(
    ({ workflowId, server }) =>
      window.openbot.workflows.startRun({ workflowId, requestId: crypto.randomUUID() }, server),
    { workflowId: workflow.summary.id, server: LOCAL_SERVER_ID },
  );
  const workflowRun = await waitForEvent("system_workflow_run");
  check(
    "a workflow run is reported with its outcome, source and step counts",
    workflowRun.properties.status === "done" &&
      workflowRun.properties.source === "manual" &&
      workflowRun.properties.step_count === 2 &&
      workflowRun.properties.agent_step_count === 1 &&
      typeof workflowRun.properties.duration_ms === "number",
    workflowRun.properties,
  );

  const openTab = (url: string) => page.evaluate((address) => window.openbot.browser.open({ url: address }), url);
  const localTab = await openTab(`http://localhost:${localPage.port}/?token=${MARKER}local`);
  cleanup.push(() => page.evaluate((id) => window.openbot.browser.close(id), localTab.id));
  const publicTab = await openTab(`https://user:${MARKER}pw@example.com/${MARKER}path?token=${MARKER}query`);
  cleanup.push(() => page.evaluate((id) => window.openbot.browser.close(id), publicTab.id));
  const visit = await waitForEvent("system_site_visited", (event) => event.properties.domain === "example.com");
  check("a site visit names the registrable domain only", visit.properties.domain === "example.com", visit.properties);
  check(
    "a local host is never named",
    !captured.some((event) => event.name === "system_site_visited" && event.properties.domain !== "example.com"),
  );

  // With analytics off nothing is sent. The visit after analytics is back on proves the queue moved.
  await page.evaluate(() => window.openbot.setAnalyticsPreference({ enabled: false }));
  const offTab = await openTab("https://example.org/");
  cleanup.push(() => page.evaluate((id) => window.openbot.browser.close(id), offTab.id));
  await page.waitForFunction(
    (id) => window.openbot.browser.listTabs().then((tabs) => tabs.some((tab) => tab.id === id && !tab.loading)),
    offTab.id,
    { timeout: EVENT_TIMEOUT_MS },
  );
  await page.evaluate(() => window.openbot.setAnalyticsPreference({ enabled: true }));
  const onTab = await openTab("https://example.net/");
  cleanup.push(() => page.evaluate((id) => window.openbot.browser.close(id), onTab.id));
  await waitForEvent("system_site_visited", (event) => event.properties.domain === "example.net");
  check("nothing is sent while analytics is off", !captured.some((event) => event.properties.domain === "example.org"));
} catch (error) {
  check("the scenario ran to the end", false, error instanceof Error ? error.message : String(error));
} finally {
  for (const step of cleanup.reverse()) {
    try {
      await step();
    } catch (error) {
      logger.warn("A cleanup step failed.", { error: error instanceof Error ? error.message : String(error) });
    }
  }
  await page.evaluate((enabled) => window.openbot.setAnalyticsPreference({ enabled }), trackingBefore.enabled);
  rmSync(fakeDirectory, { recursive: true, force: true });

  const analytics = captured.filter((entry) => entry.method === "POST");
  const leaks = analytics.filter((entry) =>
    [entry.url, entry.body, entry.headers].some((text) => text.toLowerCase().includes(MARKER)),
  );
  check("no analytics request carries a seeded value", analytics.length > 0 && leaks.length === 0, {
    requests: analytics.length,
    leaks: leaks.map((entry) => ({ name: entry.name, body: entry.body })),
  });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(
    resolve(OUT, "report.json"),
    `${JSON.stringify(
      {
        marker: MARKER,
        results,
        failureReportsSent: analytics.filter((entry) => entry.name === "system_operation_failed").length,
        events: analytics.map((entry) => ({ name: entry.name, properties: entry.properties })),
      },
      null,
      2,
    )}\n`,
  );
  await session.close();
  for (const server of [...capture.servers, ...localPage.servers]) server.close();
}
const failed = results.filter((result) => !result.passed);
for (const result of failed) logger.error(`Failed: ${result.name}.`, { detail: result.detail });
assert.equal(failed.length, 0, `${failed.length} of ${results.length} analytics redaction checks failed.`);
logger.info(`Passed ${results.length} analytics redaction checks. Wrote ${resolve(OUT, "report.json")}.`);
