// Runs the real service and Claude adapter against a local stream-json process. No model or account
// is contacted. Checks native compaction terminal states and that queued messages run once.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import type { AgentClient, DiagnosticOrigin } from "../src/backend/agent-client";
import type { ClaudeCliInfo } from "../src/backend/cli";
import type { AppServerNotification, AppServerRequest, RequestId, ResponseDecoder } from "../src/backend/protocol";
import type { ReadProviderHistory } from "../src/backend/provider-history";

const OUT = resolve(
  process.env.OPENBOT_TEST_OUTPUT_DIR ?? join(import.meta.dirname, "../.openbot-build/claude-compaction-e2e"),
);
const root = await mkdtemp(join(tmpdir(), "openbot-claude-compaction-"));
const home = join(root, "home");
const userData = join(root, "user-data");
const executable = join(root, "claude");
const protocol = join(root, "protocol.jsonl");
// Drop inherited credentials and provider endpoints before any service module loads. The child
// receives this isolated environment too. Do not inherit the running desktop's profile or MCPs.
const keep = new Set(["PATH", "TMPDIR", "TEMP", "TMP", "SystemRoot", "WINDIR"]);
for (const key of Object.keys(process.env)) if (!keep.has(key)) delete process.env[key];
process.env.HOME = home;
process.env.CLAUDE_CONFIG_DIR = join(home, ".claude");
process.env.OPENBOT_CLAUDE_PATH = executable;
mkdirSync(join(home, ".claude", "projects"), { recursive: true });

const { AGENT_PROVIDERS, defaultProviderModel } = await import("@openbot/contracts/ipc");
const { Effect } = await import("effect");
const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { ClaudeAgentClient } = await import("../src/backend/claude-client");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");
const { providerSync } = await import("../src/backend/provider-client-effects");
const { getString } = await import("../src/backend/protocol");
const MODEL = defaultProviderModel("claude");

const standIn = `#!${process.execPath}
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
if (process.argv.includes("--version")) { process.stdout.write("2.1.302 (Claude Code)\\n"); process.exit(0); }
const args = process.argv.slice(2);
const option = (name) => {
  const i = args.findIndex((arg) => arg === name || arg.startsWith(name + "="));
  return i < 0 ? null : args[i] === name ? args[i + 1] : args[i].slice(name.length + 1);
};
const session = option("--resume") ?? option("--session-id") ?? randomUUID();
const frame = (entry) => ({ ...entry, parent_tool_use_id: null, session_id: session });
const write = (entry) => process.stdout.write(JSON.stringify(frame(entry)) + "\\n");
const log = (entry) => fs.appendFileSync(${JSON.stringify(protocol)}, JSON.stringify(entry) + "\\n");
const turn = (message) => {
  const match = JSON.stringify(message.message).match(/case:(missing|success|boundary|failed|turn-failed|interrupted|normal)/);
  const name = match?.[1] ?? "normal";
  log({ session, uuid: message.uuid, name });
  write({ type: "stream_event", uuid: randomUUID(), user_message_uuid: message.uuid, user_message_uuids: [message.uuid],
    event: { type: "message_start", message: { id: "msg_" + message.uuid, type: "message", role: "assistant", content: [] } } });
  const finish = () => {
    if (name === "success" || name === "failed")
      write({ type: "system", subtype: "status", status: null, compact_result: name });
    if (name === "boundary")
      write({ type: "system", subtype: "compact_boundary", compact_metadata: { trigger: "auto", pre_tokens: 90000 } });
    const text = "Answer " + name;
    write({ type: "assistant", uuid: randomUUID(), user_message_uuid: message.uuid,
      message: { id: "msg_" + message.uuid, type: "message", role: "assistant", model: ${JSON.stringify(MODEL)},
        content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } } });
    const failure = name === "turn-failed" || name === "interrupted";
    write({ type: "result", subtype: failure ? "error_during_execution" : "success", is_error: failure,
      errors: failure ? [name === "interrupted" ? "Turn interrupted" : "Controlled failure"] : [],
      result: text, uuid: randomUUID(), duration_ms: 1, duration_api_ms: 1, num_turns: 1,
      total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 1 }, permission_denials: [] });
  };
  if (name === "normal") { finish(); return; }
  const release = ${JSON.stringify(root)} + "/release-" + name;
  let ended = false;
  const ready = () => { if (ended || !fs.existsSync(release)) return; ended = true; watcher.close(); finish(); };
  const watcher = fs.watch(${JSON.stringify(root)}, ready);
  write({ type: "system", subtype: "status", status: "compacting" });
  ready();
};
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let end;
  while ((end = buffer.indexOf("\\n")) >= 0) {
    const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
    if (!line.trim()) continue;
    const message = JSON.parse(line);
    if (message.type === "control_request")
      write({ type: "control_response", response: { subtype: "success", request_id: message.request_id, response: {} } });
    else if (message.type === "user") turn(message);
  }
});
process.stdin.on("end", () => process.exit(0));
`;

interface ClientEvents {
  notification: [notification: AppServerNotification];
  request: [request: AppServerRequest];
  exit: [error: Error];
  diagnostic: [message: string, origin?: DiagnosticOrigin];
}
const observed: Array<{ threadId: string; status: string }> = [];
/** Only replaces account/model probes; turn handling and notifications use the real adapter. */
class LocalClaude extends EventEmitter<ClientEvents> implements AgentClient {
  readonly provider = "claude";
  readonly contextCompaction = "native";
  readonly #real: InstanceType<typeof ClaudeAgentClient>;
  readonly readHistory: ReadProviderHistory;
  constructor(cli: ClaudeCliInfo) {
    super();
    assert.equal(cli.executable, executable, "The provider must be the local protocol process.");
    this.#real = new ClaudeAgentClient(cli);
    this.readHistory = this.#real.readHistory;
    this.#real.on("notification", (notification) => {
      if (notification.method === "openbot/context-compaction") {
        const threadId = getString(notification.params, "threadId");
        const status = getString(notification.params, "status");
        assert.ok(threadId && status, "The adapter identifies the compaction and its state.");
        observed.push({ threadId, status });
      }
      this.emit("notification", notification);
    });
    this.#real.on("request", (request) => this.emit("request", request));
    this.#real.on("diagnostic", (message) => this.emit("diagnostic", message));
    this.#real.on("exit", (error) => this.emit("exit", error));
  }
  get running() {
    return this.#real.running;
  }
  start() {
    this.#real.start();
  }
  stop() {
    return this.#real.stop();
  }
  canReleaseProcess = () => this.#real.canReleaseProcess();
  releaseThread(id: string) {
    return this.#real.releaseThread(id);
  }
  releaseIdleThreads() {
    return this.#real.releaseIdleThreads();
  }
  request<T>(method: string, params: unknown, decoder: ResponseDecoder<T>, timeoutMs?: number) {
    if (this.#real.running) {
      if (method === "account/read")
        return providerSync(() => decoder({ account: { type: "claude", email: "local@example.com" } }));
      if (method === "account/rateLimits/read")
        return providerSync(() => decoder({ rateLimits: null, rateLimitsByLimitId: null }));
      if (method === "model/list")
        return providerSync(() => decoder({ data: [{ model: MODEL, displayName: "Claude" }] }));
    }
    return this.#real.request(method, params, decoder, timeoutMs);
  }
  notify() {
    this.#real.notify();
  }
  respond(id: RequestId, result: unknown) {
    this.#real.respond(id, result);
  }
  respondError(id: RequestId, error: Parameters<AgentClient["respondError"]>[1]) {
    this.#real.respondError(id, error);
  }
}
const unused = () => Effect.die(new Error("The protocol check must not use a browser."));
const browser: AgentBrowserHost = {
  listTabs: () => [],
  beginTakeover: unused,
  endTakeover: () => {},
  userControlTabFor: () => null,
  awaitUserControlRelease: unused,
  resolveUploadTarget: unused,
  handleDynamicTool: unused,
  onChanged: () => () => {},
  onControlChanged: () => () => {},
  onDocumentChanged: () => () => {},
  clearControls: () => {},
  endControl: () => {},
  close: () => Effect.void,
  clearAgentSession: () => Effect.void,
};
const report: { passed: boolean; cases: object[]; error?: string; cleanup?: boolean } = { passed: false, cases: [] };
let database: InstanceType<typeof OpenBotDatabase> | undefined;
let agents: InstanceType<typeof AgentService> | undefined;
// Reject through the normal cleanup path on the overall deadline, rather than abandoning children.
let hardDeadline: ReturnType<typeof setTimeout> | undefined;
try {
  await Promise.race([
    (async () => {
      await writeFile(executable, standIn, { mode: 0o755 });
      database = new OpenBotDatabase(userData);
      const store = new AgentStore(userData, home, database);
      const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
      agents = new AgentService({
        store,
        mailbox,
        browser,
        preferredProvider: "claude",
        offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "claude"),
        busyMessageMode: () => "queue",
        clientFactory: (_provider, cli) => new LocalClaude(cli),
      });
      const service = agents;
      // Observe service events rather than sleeping until a guessed duration has elapsed.
      const waitFor = <T>(label: string, read: () => T | false | null | undefined): Promise<T> =>
        new Promise((done, fail) => {
          const cleanup = () => {
            clearTimeout(timer);
            service.off("event", check);
          };
          const check = () => {
            const value = read();
            if (value) {
              cleanup();
              done(value);
            }
          };
          const timer = setTimeout(() => {
            cleanup();
            fail(new Error(`Timed out waiting for ${label}.`));
          }, 20_000);
          service.on("event", check);
          check();
        });
      await runCauseEffect(service.initialize());
      const outcomes = [
        { name: "missing", expected: "failed", turnStatus: "completed" },
        { name: "success", expected: "completed", turnStatus: "completed" },
        { name: "boundary", expected: "completed", turnStatus: "completed" },
        { name: "failed", expected: "failed", turnStatus: "completed" },
        { name: "turn-failed", expected: "failed", turnStatus: "failed" },
        { name: "interrupted", expected: "failed", turnStatus: "interrupted" },
      ];
      for (const entry of outcomes) {
        const agent = await runCauseEffect(
          service.createAgent({
            name: `Compaction ${entry.name}`,
            description: "Local native compaction protocol check.",
            avatarSeed: entry.name,
            avatarHue: null,
            initialMessage: `case:${entry.name}`,
            provider: "claude",
            model: MODEL,
          }),
        );
        const context = () => service.getRuntimeSnapshot().contextStates?.find((state) => state.agentId === agent.id);
        await waitFor("the native running event", () => context()?.compaction?.status === "running");
        const first = service.listQueue(agent.id).deliveries.find((delivery) => delivery.status === "running");
        assert.ok(first, "The compaction belongs to a running delivery.");
        const receipt = await runCauseEffect(service.sendMessage({ agentId: agent.id, text: "case:normal" }));
        const next = receipt.deliveries[0]?.id;
        assert.ok(next);
        assert.equal(mailbox.getDelivery(next)?.delivery.status, "queued", "The next message must wait.");
        await writeFile(join(root, `release-${entry.name}`), "end");
        await waitFor("both deliveries to end", () => {
          const deliveries = service.listQueue(agent.id).deliveries;
          return (
            deliveries.length >= 2 &&
            deliveries.every((delivery) => ["completed", "failed", "interrupted"].includes(delivery.status))
          );
        });
        const state = context()?.compaction?.status;
        const session = store.activeProviderSession(agent.id)?.externalSessionId;
        const sent = readFileSync(protocol, "utf8")
          .trim()
          .split("\n")
          .map((line) => {
            const entry = JSON.parse(line);
            const session = getString(entry, "session");
            const uuid = getString(entry, "uuid");
            const name = getString(entry, "name");
            assert.ok(session && uuid && name, "The local process records each protocol message.");
            return { session, uuid, name };
          })
          .filter((line) => line.session === session);
        const terminal = observed.filter((item) => item.threadId === session && item.status !== "running");
        const actualTurn = mailbox.getDelivery(first.id)?.delivery.status;
        report.cases.push({
          name: entry.name,
          expected: entry.expected,
          actual: state,
          turnStatus: actualTurn,
          queuedStatus: mailbox.getDelivery(next)?.delivery.status,
          protocolTurns: sent.map((item) => item.name),
          terminal: terminal.map((item) => item.status),
        });
        assert.equal(
          state,
          entry.expected,
          `${entry.name}: a finished turn must not leave native compaction running or report unproven success.`,
        );
        assert.equal(actualTurn, entry.turnStatus, "Compaction cleanup must not change the turn result.");
        assert.equal(mailbox.getDelivery(next)?.delivery.status, "completed", "The queued message must complete.");
        assert.deepEqual(
          sent.map((item) => item.name),
          [entry.name, "normal"],
          "Each message must run once, in order, on the same process.",
        );
        assert.equal(new Set(sent.map((item) => item.uuid)).size, 2, "The deliveries have distinct protocol IDs.");
        assert.deepEqual(
          terminal.map((item) => item.status),
          [entry.expected],
          "There is one terminal notification.",
        );
      }
      report.passed = true;
    })(),
    new Promise<never>((_done, fail) => {
      hardDeadline = setTimeout(() => fail(new Error("The protocol check exceeded its deadline.")), 60_000);
    }),
  ]);
} catch (error) {
  report.passed = false;
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  try {
    if (agents) await runCauseEffect(agents.stop());
    database?.close();
    await rm(root, { recursive: true, force: true });
    report.cleanup = true;
  } catch (error) {
    report.passed = false;
    report.cleanup = false;
    report.error = `Cleanup failed: ${error instanceof Error ? error.message : String(error)}`;
    process.exitCode = 1;
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  clearTimeout(hardDeadline);
  process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${join(OUT, "report.json")}\n`);
  if (report.error) process.stdout.write(`${report.error}\n`);
}
