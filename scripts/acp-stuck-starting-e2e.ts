// A custom ACP agent loses its session store after a restart. A channel delivery must not stay
// `starting` with no turn id: a logged or returned missing session opens a new session, a resume
// that neither answers nor logs a store miss opens a new session, and a delivery left `starting`
// by the previous process is interrupted on the next start.
// bun scripts/acp-stuck-starting-e2e.ts
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS, type AgentEvent } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import type { AgentClient, DiagnosticOrigin } from "../src/backend/agent-client";
import type {
  AppServerNotification,
  AppServerRequest,
  RequestId,
  ResponseDecoder,
  RpcError,
} from "../src/backend/protocol";
import { providerSync, requiredString } from "../src/backend/provider-client-effects";
import { NO_PROVIDER_CREDENTIALS } from "../src/backend/provider-drivers";
import { CustomAgentStore } from "../src/main/custom-agent-store";
import { installFakeAgent, readJsonl, xorCipher } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/acp-stuck-starting-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-acp-stuck-"));
const profile = join(root, "profile");
const home = join(root, "home");
const controlPath = join(root, "control.json");
const logPath = join(root, "wire.jsonl");
await mkdir(home, { recursive: true });
process.env.HOME = home;

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");

type Mode = "ok" | "store-miss" | "chisel-error" | "hang";
const AGENT_ID = "devin";
const MODEL = `${AGENT_ID}/default`;

const unused = () => Effect.die(new Error("The fixture does not use browser control."));
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

const database = new OpenBotDatabase(profile);
const store = new AgentStore(profile, home, database);
const mailbox = new MailboxStore(profile, store.sharedRoot, database);
const custom = new CustomAgentStore({ path: join(root, "custom-agents.json"), cipher: xorCipher });
const report: { passed: boolean; cases: string[]; error?: string } = { passed: false, cases: [] };

async function setMode(mode: Mode) {
  await writeFile(controlPath, `${JSON.stringify({ mode })}\n`);
}

function openService(
  limits: { requestTimeoutMs?: number; startingWithoutTurnMs?: number; longStartTimeoutMs?: number } = {},
) {
  const service = new AgentService({
    store,
    mailbox,
    browser,
    preferredProvider: "acp",
    preferredModel: MODEL,
    offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "acp"),
    requestTimeoutMs: limits.requestTimeoutMs ?? 5_000,
    ...(limits.startingWithoutTurnMs === undefined ? {} : { startingWithoutTurnMs: limits.startingWithoutTurnMs }),
    ...(limits.longStartTimeoutMs === undefined ? {} : { longStartTimeoutMs: limits.longStartTimeoutMs }),
    credentials: { ...NO_PROVIDER_CREDENTIALS, customAgents: () => custom.configs() },
  });
  const errors: Extract<AgentEvent, { type: "error" }>[] = [];
  service.on("event", (event) => {
    if (event.type === "error") errors.push(event);
  });
  return { service, errors };
}

async function until(label: string, ready: () => boolean, timeoutMs = 8_000) {
  const started = Date.now();
  while (!ready()) {
    if (Date.now() - started > timeoutMs) throw new Error(`Fixture did not reach ${label}.`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

let service = openService().service;

try {
  await setMode("ok");
  await installFakeAgent(join(root, "bin", "devin"), "stuck-session", {
    FAKE_CONTROL: controlPath,
    FAKE_LOG: logPath,
  });
  await runCauseEffect(custom.load());
  await runCauseEffect(
    custom.save({
      id: AGENT_ID,
      name: "Devin",
      command: join(root, "bin", "devin"),
      args: ["acp"],
      env: [],
      usagePrompt: null,
    }),
  );
  await runCauseEffect(service.initialize());
  const agent = await runCauseEffect(
    service.createAgent({
      name: "Devin-Fourm",
      description: "Synthetic ACP member.",
      avatarSeed: "devin-fourm",
      avatarHue: null,
      initialMessage: "Hello fixture.",
    }),
  );
  await until(
    "the first chat turn",
    () =>
      !service
        .listQueue(agent.id)
        .deliveries.some((delivery) => ["queued", "starting", "running"].includes(delivery.status)),
  );

  const actor = { id: "local", name: "Fixture reader" };
  const channelId = randomUUID();
  const saveChannel = (id: string, name: string) =>
    runCauseEffect(
      service.channels.command(
        {
          type: "save",
          operationId: randomUUID(),
          channelId: id,
          draft: { name, title: "", instructions: "", members: [{ agentId: agent.id }], leadAgentId: agent.id },
        },
        actor,
      ),
    );
  const send = async (id: string, text: string) => {
    await runCauseEffect(
      service.channels.command(
        {
          type: "send",
          operationId: randomUUID(),
          channelId: id,
          text,
          recipientAgentId: agent.id,
          replyToMessageId: null,
          attachmentDraftIds: [],
        },
        actor,
      ),
    );
    const task = service.channels.store.tasks(id).find((item) => item.instruction === text);
    assert.ok(task, text);
    return task.id;
  };
  await saveChannel(channelId, "Tunner");
  const healthyId = await send(channelId, "First assignment.");
  await until(
    "the first channel task",
    () => service.channels.store.tasks(channelId).find((item) => item.id === healthyId)?.state === "completed",
  );
  report.cases.push("A saved ACP session accepts a channel assignment.");

  await runCauseEffect(service.stop());
  await setMode("store-miss");
  service = openService({ startingWithoutTurnMs: 30_000 }).service;
  await runCauseEffect(service.initialize());
  const newSessionsBeforeMiss = (await readJsonl<{ event?: string }>(logPath)).filter(
    (entry) => entry.event === "session/new",
  ).length;
  const replacedId = await send(channelId, "Resume the missing store session.");
  await until(
    "a fresh session after the store miss",
    () => service.channels.store.tasks(channelId).find((item) => item.id === replacedId)?.state === "completed",
  );
  const replacedLog = await readJsonl<{ event?: string; mode?: string }>(logPath);
  assert.ok(replacedLog.some((entry) => entry.event === "session/resume" && entry.mode === "store-miss"));
  assert.ok(
    replacedLog.filter((entry) => entry.event === "session/new").length > newSessionsBeforeMiss,
    "A session missing from the store must be replaced.",
  );
  assert.ok(
    !service.listQueue(agent.id).deliveries.some((delivery) => delivery.status === "starting" && !delivery.turnId),
  );
  report.cases.push("A Chisel store-miss log opens a new session and the delivery leaves starting.");

  await runCauseEffect(service.stop());
  await setMode("chisel-error");
  service = openService({ startingWithoutTurnMs: 30_000 }).service;
  await runCauseEffect(service.initialize());
  const beforeNew = (await readJsonl<{ event?: string }>(logPath)).filter(
    (entry) => entry.event === "session/new",
  ).length;
  const chiselId = await send(channelId, "Resume the Chisel error session.");
  await until(
    "a fresh session after the Chisel error",
    () => service.channels.store.tasks(channelId).find((item) => item.id === chiselId)?.state === "completed",
  );
  const chiselNew = (await readJsonl<{ event?: string }>(logPath)).filter(
    (entry) => entry.event === "session/new",
  ).length;
  assert.ok(chiselNew > beforeNew, "JSON-RPC -32016 Session not found must open a new session.");
  report.cases.push("A custom agent Chisel missing-session error opens a new session.");

  await runCauseEffect(service.stop());
  await setMode("hang");
  const beforeHangNew = (await readJsonl<{ event?: string }>(logPath)).filter(
    (entry) => entry.event === "session/new",
  ).length;
  service = openService({ requestTimeoutMs: 60_000, startingWithoutTurnMs: 30_000 }).service;
  await runCauseEffect(service.initialize());
  const silentStarted = Date.now();
  const silentId = await send(channelId, "Resume and do not answer.");
  await until(
    "a fresh session after a silent resume",
    () => service.channels.store.tasks(channelId).find((item) => item.id === silentId)?.state === "completed",
    40_000,
  );
  const silentMs = Date.now() - silentStarted;
  assert.ok(silentMs < 45_000, `A silent resume must not wait for the two-minute limit (${silentMs}ms).`);
  const hangLog = await readJsonl<{ event?: string; mode?: string }>(logPath);
  const hangAt = hangLog.findLastIndex((entry) => entry.event === "session/resume" && entry.mode === "hang");
  assert.ok(hangAt >= 0, "The resume must be sent and must not log a store miss.");
  const afterHang = hangLog.slice(hangAt + 1);
  assert.ok(
    afterHang.some((entry) => entry.event === "session/new"),
    "A silent resume must open a new session.",
  );
  assert.ok(
    afterHang.some((entry) => entry.event === "session/prompt"),
    "The new session must run the turn.",
  );
  assert.ok(
    hangLog.filter((entry) => entry.event === "session/new").length > beforeHangNew,
    "A silent resume must open a new session.",
  );
  assert.ok(
    !service.listQueue(agent.id).deliveries.some((delivery) => delivery.status === "starting" && !delivery.turnId),
  );
  assert.ok(
    !service.listQueue(agent.id).deliveries.some((delivery) => delivery.error?.includes("did not start this turn")),
  );
  report.cases.push(`A resume that neither answers nor logs a store miss opens a new session in ${silentMs}ms.`);

  await runCauseEffect(service.stop());
  await setMode("ok");
  const parked = await runCauseEffect(
    mailbox.enqueue({
      sender: { kind: "user" },
      recipientAgentIds: [agent.id],
      text: "Left in starting by the previous process.",
      idempotencyKey: `restart-${randomUUID()}`,
    }),
  );
  const stuckId = parked.deliveries[0]?.id;
  assert.ok(stuckId);
  await runCauseEffect(mailbox.markStarting(stuckId));
  service = openService({ requestTimeoutMs: 800, startingWithoutTurnMs: 30_000 }).service;
  await runCauseEffect(service.initialize());
  await until(
    "the restart to interrupt the starting delivery",
    () => service.listQueue(agent.id).deliveries.find((item) => item.id === stuckId)?.status === "interrupted",
    6_000,
  );
  const recovered = service.listQueue(agent.id).deliveries.find((item) => item.id === stuckId);
  assert.equal(recovered?.status, "interrupted");
  assert.equal(recovered?.turnId, null);
  assert.match(recovered?.error ?? "", /restarted before this delivery reached a confirmed terminal state/);
  report.cases.push("A starting delivery with no turn id is interrupted after a restart.");

  await runCauseEffect(service.stop());
  let holdResume = false;
  class HoldResume extends EventEmitter<ClientEvents> implements AgentClient {
    readonly provider = "acp" as const;
    running = false;
    start() {
      this.running = true;
    }
    stop() {
      return Effect.sync(() => {
        this.running = false;
      });
    }
    request<T>(method: string, params: unknown, decoder: ResponseDecoder<T>) {
      if (method === "thread/resume" && holdResume)
        return Effect.sleep(5_000).pipe(Effect.map(() => decoder({ thread: { id: "thread-fixture" } })));
      switch (method) {
        case "initialize":
        case "turn/interrupt":
          return providerSync(() => decoder({}));
        case "account/read":
          return providerSync(() => decoder({ account: { type: "acp" } }));
        case "account/rateLimits/read":
          return providerSync(() => decoder({ rateLimits: null, rateLimitsByLimitId: null }));
        case "model/list":
          return providerSync(() => decoder({ data: [{ model: "fixture", displayName: "Fixture" }] }));
        case "plugin/list":
          return providerSync(() => decoder({ marketplaces: [] }));
        case "thread/start":
          return providerSync(() => decoder({ thread: { id: "thread-fixture" } }));
        case "thread/resume":
        case "thread/read":
          return providerSync(() => decoder({ thread: { id: requiredString(params, "threadId"), turns: [] } }));
        case "turn/start":
          return providerSync(() => {
            const threadId = requiredString(params, "threadId");
            const turnId = requiredString(params, "clientUserMessageId");
            this.emit("notification", { method: "turn/started", params: { threadId, turn: { id: turnId } } });
            queueMicrotask(() => {
              this.emit("notification", {
                method: "turn/completed",
                params: { threadId, turn: { id: turnId, status: "completed" } },
              });
            });
            return decoder({ turn: { id: turnId, status: "inProgress" } });
          });
        default:
          return providerSync(() => decoder({}));
      }
    }
    notify() {}
    respond(_id: RequestId, _result: unknown) {}
    respondError(_id: RequestId, _error: RpcError) {}
  }
  interface ClientEvents {
    notification: [notification: AppServerNotification];
    request: [request: AppServerRequest];
    exit: [error: Error];
    diagnostic: [message: string, origin?: DiagnosticOrigin];
  }
  const limitRoot = join(root, "limit");
  const limitDatabase = new OpenBotDatabase(limitRoot);
  const limitStore = new AgentStore(limitRoot, join(root, "limit-home"), limitDatabase);
  const limitMailbox = new MailboxStore(limitRoot, limitStore.sharedRoot, limitDatabase);
  const limitService = () =>
    new AgentService({
      store: limitStore,
      mailbox: limitMailbox,
      browser,
      preferredProvider: "acp",
      preferredModel: "fixture",
      offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "acp"),
      startingWithoutTurnMs: 400,
      credentials: { ...NO_PROVIDER_CREDENTIALS, customAgents: () => custom.configs() },
      clientFactory: () => new HoldResume(),
    });
  service = limitService();
  await runCauseEffect(service.initialize());
  const limitAgent = await runCauseEffect(
    service.createAgent({
      name: "Hold",
      description: "Synthetic resume.",
      avatarSeed: "hold",
      avatarHue: null,
      initialMessage: "Hello hold.",
    }),
  );
  await until(
    "the hold fixture chat",
    () =>
      !service
        .listQueue(limitAgent.id)
        .deliveries.some((delivery) => ["queued", "starting", "running"].includes(delivery.status)),
  );
  await runCauseEffect(service.stop());
  holdResume = true;
  service = limitService();
  await runCauseEffect(service.initialize());
  const slow = await runCauseEffect(
    service.sendMessage(
      { agentId: limitAgent.id, text: "Resume and do not answer yet.", attachmentDraftIds: [] },
      actor,
    ),
  );
  const slowId = slow.deliveries[0]?.id;
  assert.ok(slowId);
  await until(
    "the start limit to interrupt the delivery",
    () => {
      const row = service.listQueue(limitAgent.id).deliveries.find((item) => item.id === slowId);
      return row?.status === "interrupted" && row.turnId === null;
    },
    3_000,
  );
  report.cases.push("A resume that does not yield a turn id is interrupted by the start limit.");
  await until(
    "the held resume to finish",
    () => service.listQueue(limitAgent.id).deliveries.find((item) => item.id === slowId)?.status === "interrupted",
    8_000,
  );
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  await runCauseEffect(service.stop()).catch(() => undefined);
  database.close();
  await rm(root, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
