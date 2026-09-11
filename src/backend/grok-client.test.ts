import { AcpAgentClient } from "./acp-client";
import { NO_PROVIDER_CREDENTIALS, requireProviderDriver } from "./provider-drivers";
// @vitest-environment node

import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GrokAgentClient } from "./grok-client";
import {
  type AppServerNotification,
  type AppServerRequest,
  decodeAccountRateLimitsReadResult,
  decodeAccountReadResult,
  decodeModelListResponse,
  decodeRecordResponse,
  decodeThreadResponse,
  decodeTurnResponse,
} from "./protocol";

let root: string;
let executable: string;
let logPath: string;
let client: AcpAgentClient | null = null;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "openbot-grok-acp-"));
  executable = join(root, "grok");
  logPath = join(root, "fake-grok.jsonl");
  await writeFile(executable, FAKE_GROK_ACP);
  await chmod(executable, 0o700);
  process.env.OPENBOT_FAKE_GROK_LOG = logPath;
  delete process.env.OPENBOT_FAKE_GROK_MODE;
});

afterEach(async () => {
  await client?.stop();
  client = null;
  delete process.env.OPENBOT_FAKE_GROK_LOG;
  delete process.env.OPENBOT_FAKE_GROK_MODE;
  await rm(root, { recursive: true, force: true });
});

describe.sequential("GrokAgentClient", () => {
  it("runs OpenCode ACP without Grok authentication or billing and preserves its resumed session", async () => {
    client = new AcpAgentClient({ executable, version: "1.0.0" }, 5_000, {
      provider: "opencode",
      argv: ["acp"],
      env: {},
      signInMessage: "Connect OpenCode.",
    });
    client.start();
    await client.request("initialize", {}, decodeRecordResponse);
    expect((await client.request("account/read", {}, decodeAccountReadResult)).account?.type).toBe("opencode");
    expect(await client.request("account/rateLimits/read", {}, decodeAccountRateLimitsReadResult)).toEqual({
      rateLimits: null,
      rateLimitsByLimitId: null,
    });
    const resumed = await client.request(
      "thread/resume",
      { threadId: "existing-opencode-session", cwd: root, dynamicTools: [] },
      decodeThreadResponse,
    );
    expect(resumed.thread.id).toBe("existing-opencode-session");
    const log = (await readFile(logPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(log).toContainEqual(expect.objectContaining({ event: "start", args: ["acp"] }));
    expect(log.some((entry) => entry.method === "authenticate" || entry.method === "_x.ai/billing")).toBe(false);
    expect(log).toContainEqual(
      expect.objectContaining({ method: "session/load", sessionId: "existing-opencode-session" }),
    );
  });

  it.each([
    ["empty", "failed"],
    ["whitespace", "failed"],
    ["thought", "failed"],
    ["tools", "completed"],
    ["answer", "completed"],
    ["cancel", "interrupted"],
  ])("handles OpenCode %s turns and allows a retry in the same session", async (mode, status) => {
    process.env.OPENBOT_FAKE_GROK_MODE = `opencode-${mode}`;
    client = new AcpAgentClient({ executable, version: "1.3.13" }, 5_000, {
      provider: "opencode",
      argv: ["acp"],
      env: {},
      signInMessage: "Connect OpenCode.",
    });
    const notifications: AppServerNotification[] = [];
    client.on("notification", (event) => notifications.push(event));
    client.start();
    const { thread } = await client.request("thread/start", { cwd: root }, decodeThreadResponse);
    await client.request(
      "turn/start",
      { threadId: thread.id, input: [{ type: "text", text: "Answer" }] },
      decodeTurnResponse,
    );
    await waitFor(() => notifications.some((event) => event.method === "turn/completed"));
    expect(notifications.find((event) => event.method === "turn/completed")?.params).toMatchObject({
      turn: { status },
    });
    const errors = notifications.filter((event) => event.method === "error");
    if (status === "failed")
      expect(errors).toEqual([
        expect.objectContaining({
          params: expect.objectContaining({
            threadId: thread.id,
            message:
              "OpenCode returned no response. Check the selected model's sign-in and billing in OpenCode, then retry or choose another model.",
          }),
        }),
      ]);
    else expect(errors).toEqual([]);
    notifications.length = 0;
    await client.request(
      "turn/start",
      { threadId: thread.id, input: [{ type: "text", text: "Retry" }] },
      decodeTurnResponse,
    );
    await waitFor(() => notifications.some((event) => event.method === "turn/completed"));
    const history = await client.request("thread/read", { threadId: thread.id }, decodeThreadResponse);
    expect(history.thread.turns?.map((turn) => turn.status)).toEqual([status, "completed"]);
    expect(history.thread.turns?.[1]?.items).toContainEqual(expect.objectContaining({ text: "Reply after retry." }));
  });

  it("uses external sign-in for OpenCode and creates its ACP process", async () => {
    const driver = requireProviderDriver("opencode");
    expect(driver.signIn).toEqual({ kind: "external" });
    const providerClient = driver.createClient({ executable, version: "1.0.0" }, 5_000, NO_PROVIDER_CREDENTIALS);
    providerClient.start();
    try {
      await providerClient.request("initialize", {}, decodeRecordResponse);
      expect((await providerClient.request("account/read", {}, decodeAccountReadResult)).account?.type).toBe(
        "opencode",
      );
    } finally {
      await providerClient.stop();
    }
  });

  it("starts profile generation with no built-in tools and denies approval requests", async () => {
    client = new GrokAgentClient({ executable, version: "1.0.5" }, 5_000, true);
    const requests: AppServerRequest[] = [];
    client.on("request", (request) => requests.push(request));
    client.start();
    await client.request("initialize", {}, decodeRecordResponse);
    const thread = await client.request("thread/start", { cwd: root, dynamicTools: [] }, decodeThreadResponse);
    await client.request(
      "turn/start",
      { threadId: thread.thread.id, input: [{ type: "text", text: "Draft a profile" }] },
      decodeTurnResponse,
    );
    await vi.waitFor(async () => expect(await readFile(logPath, "utf8")).toContain("permission-response"));
    const log = (await readFile(logPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(log).toContainEqual(
      expect.objectContaining({
        event: "start",
        args: [
          "--no-auto-update",
          "--tools=",
          "--deny",
          "*",
          "--no-subagents",
          "--disable-web-search",
          "agent",
          "stdio",
        ],
      }),
    );
    expect(log).toContainEqual(expect.objectContaining({ event: "permission-response", outcome: "cancelled" }));
    expect(requests.some((request) => request.method.includes("requestApproval"))).toBe(false);
  });

  it.each(["end_turn", "cancelled", "max_tokens"])(
    "shows only the final segment in chat when Grok ends with %s",
    async (stopReason) => {
      process.env.OPENBOT_FAKE_GROK_MODE = stopReason;
      client = new GrokAgentClient({ executable, version: "1.0.5" }, 5_000);
      const notifications: AppServerNotification[] = [];
      client.on("notification", (notification) => notifications.push(notification));
      client.start();
      const { thread } = await client.request("thread/start", { cwd: root }, decodeThreadResponse);
      await client.request(
        "turn/start",
        { threadId: thread.id, input: [{ type: "text", text: "Inspect and answer" }] },
        decodeTurnResponse,
      );
      await waitFor(() => notifications.some((notification) => notification.method === "turn/completed"));
      expect(notifications.find((event) => event.method === "openbot/usage")?.params).toMatchObject({
        usage: { inputTokens: 300, outputTokens: 50, cachedReadTokens: 200 },
      });
      const history = await client.request("thread/read", { threadId: thread.id }, decodeThreadResponse);
      const messages = history.thread.turns?.[0]?.items;
      expect(messages).toEqual([
        expect.objectContaining({ phase: "commentary", text: "Planning inspection." }),
        expect.objectContaining({ phase: "commentary", text: "Inspecting files." }),
        expect.objectContaining({ phase: "commentary", text: "Reviewing findings." }),
        expect.objectContaining({ phase: "commentary", text: "Checking results." }),
        expect.objectContaining({
          phase: "final_answer",
          text: "The final answer.",
        }),
      ]);
      // Only explicit thoughts stream into activity. Unclassified text stays private until
      // a later boundary establishes commentary or the final answer.
      const phases = new Map<string, string>();
      const texts = new Map<string, string>();
      const completedAnswers: string[] = [];
      const streamedThoughts: string[] = [];
      for (const notification of notifications) {
        if (notification.method === "turn/completed") break;
        const params = notification.params;
        if (!isDynamicRecord(params)) continue;
        if (
          (notification.method === "item/started" || notification.method === "item/completed") &&
          isDynamicRecord(params.item)
        ) {
          const { id, phase } = params.item;
          if (typeof id === "string" && typeof phase === "string") phases.set(id, phase);
          if (phase === "final_answer") {
            expect(notification.method).toBe("item/completed");
            completedAnswers.push(String(params.item.text));
          }
        }
        if (notification.method === "item/agentMessage/delta") {
          const id = String(params.itemId);
          const text = (texts.get(id) ?? "") + String(params.delta);
          texts.set(id, text);
          expect(phases.get(id)).toBe("commentary");
          expect([...phases.values()]).not.toContain("final_answer");
          if (text === "Reviewing findings.") {
            const latestCommentaryId = [...phases].filter(([, phase]) => phase === "commentary").at(-1)?.[0];
            expect(texts.get(latestCommentaryId ?? "")).toBe("Reviewing findings.");
            streamedThoughts.push(text);
          }
        }
      }
      expect([...texts.values()]).toEqual(["Planning inspection.", "Reviewing findings."]);
      expect(streamedThoughts).toEqual(["Reviewing findings."]);
      expect(completedAnswers).toEqual(["The final answer."]);
      expect([...phases.values()].filter((phase) => phase === "final_answer")).toHaveLength(1);
    },
  );

  it("reads the current weekly billing period and rejects a monthly period", async () => {
    client = new GrokAgentClient({ executable, version: "1.0.5" }, 5_000);
    client.start();
    await client.request("initialize", {}, decodeRecordResponse);
    await expect(
      client.request("account/rateLimits/read", { model: "grok-4.5" }, decodeAccountRateLimitsReadResult),
    ).resolves.toMatchObject({
      rateLimits: {
        secondary: { usedPercent: 8, windowDurationMins: 10_080, resetsAt: 1_788_825_600 },
      },
    });
    await client.stop();

    process.env.OPENBOT_FAKE_GROK_MODE = "monthly-billing";
    client = new GrokAgentClient({ executable, version: "1.0.5" }, 5_000);
    client.start();
    await client.request("initialize", {}, decodeRecordResponse);
    await expect(
      client.request("account/rateLimits/read", { model: "grok-4.5" }, decodeAccountRateLimitsReadResult),
    ).resolves.toEqual({ rateLimits: null, rateLimitsByLimitId: null });
  });

  it("reports unavailable usage for a unified weekly billing period without quota values", async () => {
    process.env.OPENBOT_FAKE_GROK_MODE = "unified-billing";
    client = new GrokAgentClient({ executable, version: "1.0.13" }, 5_000);
    client.start();
    await client.request("initialize", {}, decodeRecordResponse);

    await expect(
      client.request("account/rateLimits/read", { model: "grok-4.5" }, decodeAccountRateLimitsReadResult),
    ).resolves.toEqual({ rateLimits: null, rateLimitsByLimitId: null });
  });

  it("times out a billing request that stops responding", async () => {
    process.env.OPENBOT_FAKE_GROK_MODE = "hung-billing";
    client = new GrokAgentClient({ executable, version: "1.0.13" }, 1_000);
    client.start();
    await client.request("initialize", {}, decodeRecordResponse);

    await expect(
      client.request("account/rateLimits/read", { model: "grok-4.5" }, decodeAccountRateLimitsReadResult),
    ).rejects.toThrow("Grok request timed out: account/rateLimits/read");
  });

  it.each(["grok", "opencode"] as const)(
    "%s discovers models, streams, steers, asks, approves, cancels, and resumes",
    async (provider) => {
      const createClient = () =>
        provider === "grok"
          ? new GrokAgentClient({ executable, version: "1.0.5" }, 5_000)
          : new AcpAgentClient({ executable, version: "1.3.13" }, 5_000, {
              provider,
              argv: ["acp"],
              env: {},
              signInMessage: "Connect OpenCode.",
            });
      client = createClient();
      const notifications: AppServerNotification[] = [];
      const requests: AppServerRequest[] = [];
      client.on("notification", (notification) => notifications.push(notification));
      client.on("request", (request) => requests.push(request));
      client.start();

      await client.request("initialize", {}, decodeRecordResponse);
      await expect(client.request("account/read", {}, decodeAccountReadResult)).resolves.toMatchObject({
        account: { type: provider },
      });
      const models = await client.request("model/list", {}, decodeModelListResponse);
      expect(models.data).toEqual([
        expect.objectContaining({
          model: "grok-4.5",
          defaultReasoningEffort: "xhigh",
          supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "xhigh" }],
        }),
        expect.objectContaining({ model: "grok-fast" }),
      ]);

      const started = await client.request(
        "thread/start",
        {
          cwd: root,
          runtimeWorkspaceRoots: [root],
          developerInstructions: "Use OpenBot tools.",
          dynamicTools: [],
          model: "grok-fast",
          effort: "xhigh",
        },
        decodeThreadResponse,
      );
      const threadId = started.thread.id;
      const turn = await client.request(
        "turn/start",
        {
          threadId,
          model: "grok-fast",
          effort: "xhigh",
          clientUserMessageId: "turn-1",
          input: [{ type: "text", text: "Build it" }],
        },
        decodeTurnResponse,
      );
      expect(turn.turn.status).toBe("inProgress");
      await waitFor(() => requests.some((request) => request.method.includes("requestApproval")));

      await client.request(
        "turn/steer",
        {
          threadId,
          expectedTurnId: "turn-1",
          input: [{ type: "text", text: "Also add tests" }],
        },
        decodeRecordResponse,
      );
      const approval = requests.find((request) => request.method.includes("requestApproval"));
      if (!approval) throw new Error("The fake ACP permission request was not surfaced.");
      client.respond(approval.id, { decision: "accept" });
      await waitFor(() => requests.filter((request) => request.method === "item/tool/requestUserInput").length === 1);
      const elicitation = requests.find((request) => request.method === "item/tool/requestUserInput");
      if (!elicitation) throw new Error("The standard ACP elicitation was not surfaced.");
      client.respond(elicitation.id, { answers: { language: { answers: ["TypeScript"] } } });
      await waitFor(() => requests.filter((request) => request.method === "item/tool/requestUserInput").length === 2);
      const prompt = requests.filter((request) => request.method === "item/tool/requestUserInput")[1];
      if (!prompt) throw new Error("The xAI user-input request was not surfaced.");
      client.respond(prompt.id, { answers: { confirm: { answers: ["yes"] } } });
      await waitFor(() => notifications.some((notification) => notification.method === "turn/completed"));
      expect(notifications).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ method: "turn/started" }),
          expect.objectContaining({ method: "item/agentMessage/delta" }),
          expect.objectContaining({ method: "item/completed" }),
          expect.objectContaining({ method: "turn/completed" }),
        ]),
      );
      // A thought only reaches the thinking disclosure while it is phased as commentary; without the
      // phase it arrives as an ordinary agent message and renders as a chat bubble.
      expect(notifications).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            method: "item/started",
            params: expect.objectContaining({
              item: expect.objectContaining({ type: "agentMessage", phase: "commentary" }),
            }),
          }),
          expect.objectContaining({
            method: "item/completed",
            params: expect.objectContaining({
              item: expect.objectContaining({ phase: "commentary", text: "GROK_THOUGHT" }),
            }),
          }),
        ]),
      );

      const secondTurn = await client.request(
        "turn/start",
        { threadId, clientUserMessageId: "turn-2", input: [{ type: "text", text: "Wait" }] },
        decodeTurnResponse,
      );
      await client.request("turn/interrupt", { threadId, turnId: secondTurn.turn.id }, decodeRecordResponse);
      await waitFor(() =>
        notifications.some(
          (notification) =>
            notification.method === "turn/completed" &&
            JSON.stringify(notification.params).includes('"status":"interrupted"'),
        ),
      );

      const log = await readLog();
      if (provider === "grok")
        expect(log).toContainEqual(expect.objectContaining({ method: "authenticate", methodId: "cached_token" }));
      expect(log).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: "start",
            args: provider === "grok" ? ["--no-auto-update", "agent", "stdio"] : ["acp"],
          }),
          expect.objectContaining({ method: "session/set_config_option", configId: "model", value: "grok-fast" }),
          expect.objectContaining({ method: "session/set_config_option", configId: "thought", value: "extra_high" }),
          expect.objectContaining({ event: "permission-response", optionId: "allow-once" }),
          expect.objectContaining({ event: "elicitation-response", language: "TypeScript" }),
          expect.objectContaining({ event: "user-input-response" }),
          expect.objectContaining({ method: "session/cancel" }),
        ]),
      );

      await client.stop();
      client = createClient();
      client.start();
      await client.request("initialize", {}, decodeRecordResponse);
      await expect(
        client.request("thread/resume", { threadId, cwd: root, dynamicTools: [] }, decodeRecordResponse),
      ).resolves.toEqual(expect.any(Object));
      expect(await readLog()).toEqual(
        expect.arrayContaining([expect.objectContaining({ method: "session/load", sessionId: threadId })]),
      );
    },
  );

  it("rediscovers Grok models without restarting and closes discovery sessions", async () => {
    process.env.OPENBOT_FAKE_GROK_MODE = "refresh-models";
    client = new GrokAgentClient({ executable, version: "1.0.13" }, 5_000);
    client.start();
    await client.request("initialize", {}, decodeRecordResponse);
    const models = await client.request("model/list", {}, decodeModelListResponse);
    expect(models.data).toContainEqual(expect.objectContaining({ model: "grok-future-2", displayName: "Future Grok" }));
    expect(await readLog()).toContainEqual({ method: "session/close", sessionId: "grok-session-2" });
    await expect(client.request("model/list", {}, decodeModelListResponse)).rejects.toThrow("Discovery unavailable");
    const refreshed = await client.request("model/list", {}, decodeModelListResponse);
    expect(refreshed.data.map((model) => model.model)).toEqual(["grok-4.5", "grok-fast", "grok-future-4"]);
    expect(await readLog()).toContainEqual({ method: "session/close", sessionId: "grok-session-4" });
  });

  it("bounds Grok model discovery by the caller timeout", async () => {
    process.env.OPENBOT_FAKE_GROK_MODE = "hung-models";
    client = new GrokAgentClient({ executable, version: "1.0.13" }, 5_000);
    client.start();
    await client.request("initialize", {}, decodeRecordResponse);
    await expect(client.request("model/list", {}, decodeModelListResponse, 10)).rejects.toThrow(
      "Grok request timed out: model/list",
    );
  });

  it("uses one neutral effort when thought_level is not advertised", async () => {
    process.env.OPENBOT_FAKE_GROK_MODE = "no-thought";
    client = new GrokAgentClient({ executable, version: "1.0.5" }, 5_000);
    client.start();
    await client.request("initialize", {}, decodeRecordResponse);
    const models = await client.request("model/list", {}, decodeModelListResponse);
    expect(models.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          defaultReasoningEffort: "medium",
          supportedReasoningEfforts: [{ reasoningEffort: "medium" }],
        }),
      ]),
    );
  });

  it("discovers and applies per-model reasoning efforts from Grok metadata", async () => {
    process.env.OPENBOT_FAKE_GROK_MODE = "model-metadata";
    client = new GrokAgentClient({ executable, version: "1.0.13" }, 5_000);
    client.start();
    await client.request("initialize", {}, decodeRecordResponse);

    const models = await client.request("model/list", {}, decodeModelListResponse);
    expect(models.data).toEqual([
      expect.objectContaining({
        model: "grok-4.6",
        defaultReasoningEffort: "high",
        supportedReasoningEfforts: [
          { reasoningEffort: "low" },
          { reasoningEffort: "medium" },
          { reasoningEffort: "high" },
          { reasoningEffort: "xhigh" },
        ],
      }),
      expect.objectContaining({
        model: "grok-4.5",
        defaultReasoningEffort: "medium",
        supportedReasoningEfforts: [{ reasoningEffort: "medium" }],
      }),
    ]);

    await client.request(
      "thread/start",
      { cwd: root, dynamicTools: [], model: "grok-4.6", effort: "xhigh" },
      decodeThreadResponse,
    );
    expect(await readLog()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "session/set_model",
          modelId: "grok-4.6",
          reasoningEffort: "extra_high",
        }),
      ]),
    );
    expect(await readLog()).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ method: "session/set_config_option", configId: "thought" })]),
    );

    const previousLogLength = (await readLog()).length;
    await client.request(
      "thread/start",
      { cwd: root, dynamicTools: [], model: "grok-4.5", effort: "medium" },
      decodeThreadResponse,
    );
    const unsupportedModelLog = (await readLog()).slice(previousLogLength);
    expect(unsupportedModelLog).toEqual(
      expect.arrayContaining([expect.objectContaining({ method: "session/set_model", modelId: "grok-4.5" })]),
    );
    expect(
      unsupportedModelLog.some((entry) => entry.method === "session/set_config_option" && entry.configId === "thought"),
    ).toBe(false);
    expect(
      unsupportedModelLog.some((entry) => entry.method === "session/set_model" && "reasoningEffort" in entry),
    ).toBe(false);
  });

  it("supports Grok's legacy ACP model catalog and session/set_model", async () => {
    process.env.OPENBOT_FAKE_GROK_MODE = "legacy-models";
    client = new GrokAgentClient({ executable, version: "1.0.5" }, 5_000);
    client.start();
    await client.request("initialize", {}, decodeRecordResponse);
    const models = await client.request("model/list", {}, decodeModelListResponse);
    expect(models.data).toEqual([
      expect.objectContaining({ model: "grok-4.5", displayName: "Grok 4.5" }),
      expect.objectContaining({ model: "grok-fast", displayName: "Grok Fast" }),
    ]);

    await client.request(
      "thread/start",
      { cwd: root, dynamicTools: [], model: "grok-fast", effort: "xhigh" },
      decodeThreadResponse,
    );
    expect(await readLog()).toEqual(
      expect.arrayContaining([expect.objectContaining({ method: "session/set_model", modelId: "grok-fast" })]),
    );
  });

  it("reports auth as signed out and rejects empty model discovery without a fallback", async () => {
    process.env.OPENBOT_FAKE_GROK_MODE = "auth-error";
    client = new GrokAgentClient({ executable, version: "1.0.5" }, 5_000);
    client.start();
    await client.request("initialize", {}, decodeRecordResponse);
    await expect(client.request("account/read", {}, decodeAccountReadResult)).resolves.toMatchObject({ account: null });
    await client.stop();

    process.env.OPENBOT_FAKE_GROK_MODE = "no-model";
    client = new GrokAgentClient({ executable, version: "1.0.5" }, 5_000);
    client.start();
    await expect(client.request("initialize", {}, decodeRecordResponse)).rejects.toThrow(
      "did not advertise any ACP models",
    );
  });
});

async function readLog(): Promise<DynamicRecord[]> {
  const text = await readFile(logPath, "utf8").catch(() => "");
  return text.split("\n").filter(Boolean).map(parseLogLine);
}

function parseLogLine(line: string): DynamicRecord {
  const value = JSON.parse(line);
  if (!isDynamicRecord(value)) throw new Error("The fake Grok log contains an invalid entry.");
  return value;
}

async function waitFor(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  await vi.waitFor(
    () => {
      if (!predicate()) throw new Error("Timed out waiting for the fake Grok ACP process.");
    },
    { timeout: timeoutMs },
  );
}

const FAKE_GROK_ACP = String.raw`#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const logPath = process.env.OPENBOT_FAKE_GROK_LOG;
const mode = process.env.OPENBOT_FAKE_GROK_MODE || "normal";
let sessionCounter = 0;
let promptCounter = 0;
let pendingPrompt = null;

const log = (value) => {
  if (logPath) appendFileSync(logPath, JSON.stringify(value) + "\n");
};
log({ event: "start", args: process.argv.slice(2) });
const write = (value) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...value }) + "\n");
const modelConfig = () => {
  const options = [{
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: "grok-4.5",
    options: [
      { value: "grok-4.5", name: "Grok 4.5", description: "Most capable" },
      { value: "grok-fast", name: "Grok Fast", description: "Fast" },
    ],
  }];
  if (mode === "refresh-models" && sessionCounter > 1) options[0].options.push({ value: "grok-future-" + sessionCounter, name: "Future Grok" });
  if (mode !== "no-thought") options.push({
    id: "thought",
    name: "Thought level",
    category: "thought_level",
    type: "select",
    currentValue: "extra_high",
    options: [
      { value: "low", name: "Low" },
      { value: "extra_high", name: "Extra high" },
    ],
  });
  return mode === "no-model" ? options.filter((option) => option.category !== "model") : options;
};

createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (!message.method && message.id === "permission-1") {
    log({ event: "permission-response", outcome: message.result?.outcome?.outcome, optionId: message.result?.outcome?.optionId });
    write({
      id: "elicitation-1",
      method: "elicitation/create",
      params: {
        mode: "form",
        sessionId: pendingPrompt.sessionId,
        message: "Choose a language",
        requestedSchema: {
          type: "object",
          properties: {
            language: { type: "string", title: "Language", enum: ["TypeScript", "Rust"] },
          },
          required: ["language"],
        },
      },
    });
    return;
  }
  if (!message.method && message.id === "elicitation-1") {
    log({ event: "elicitation-response", language: message.result?.content?.language });
    write({
      id: "input-1",
      method: "xai/request_user_input",
      params: {
        sessionId: pendingPrompt.sessionId,
        questions: [{ id: "confirm", header: "Confirm", question: "Continue?", options: [] }],
      },
    });
    return;
  }
  if (!message.method && message.id === "input-1") {
    log({ event: "user-input-response", hasAnswers: Boolean(message.result?.answers) });
    write({
      method: "session/update",
      params: {
        sessionId: pendingPrompt.sessionId,
        update: { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "GROK_THOUGHT" } },
      },
    });
    write({
      method: "session/update",
      params: {
        sessionId: pendingPrompt.sessionId,
        update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "GROK_DONE" } },
      },
    });
    write({ id: pendingPrompt.id, result: { stopReason: "end_turn" } });
    pendingPrompt = null;
    return;
  }
  if (message.method === "initialize") {
    log({ method: message.method });
    write({
      id: message.id,
      result: {
        protocolVersion: 1,
        agentCapabilities: { loadSession: true, sessionCapabilities: { configOptions: {} } },
        authMethods: [
          { id: "cached_token", name: "Cached login" },
          { id: "xai.api_key", name: "xAI API key" },
        ],
        agentInfo: { name: "fake-grok", version: "1.0.5" },
      },
    });
    return;
  }
  if (message.method === "authenticate") {
    log({ method: message.method, methodId: message.params.methodId });
    if (mode === "auth-error") write({ id: message.id, error: { code: -32000, message: "Authentication required. Run grok login." } });
    else write({ id: message.id, result: {} });
    return;
  }
  if (message.method === "session/new") {
    sessionCounter += 1;
    if (mode === "hung-models" && sessionCounter > 1) return;
    if (mode === "refresh-models" && sessionCounter === 3) {
      write({ id: message.id, error: { code: -32603, message: "Discovery unavailable" } });
      return;
    }
    const sessionId = "grok-session-" + sessionCounter;
    log({ method: message.method, sessionId, mcpAuthorization: message.params.mcpServers?.some((server) => server.headers?.some((header) => header.name.toLowerCase() === "authorization" && header.value.startsWith("Bearer "))) });
    const result = mode === "model-metadata"
      ? {
          sessionId,
          models: {
            currentModelId: "grok-4.6",
            availableModels: [
              {
                modelId: "grok-4.6",
                name: "Grok 4.6",
                _meta: {
                  supportsReasoningEffort: true,
                  reasoningEffort: "high",
                  reasoningEfforts: [
                    { value: "low" },
                    { value: "medium" },
                    { value: "high" },
                    { value: "extra_high" },
                    { value: "unsupported" },
                  ],
                },
              },
              {
                modelId: "grok-4.5",
                name: "Grok 4.5",
                _meta: { supportsReasoningEffort: false },
              },
            ],
          },
          configOptions: modelConfig().filter((option) => option.category === "thought_level"),
        }
      : mode === "legacy-models"
      ? {
          sessionId,
          models: {
            currentModelId: "grok-4.5",
            availableModels: [
              { modelId: "grok-4.5", name: "Grok 4.5" },
              { modelId: "grok-fast", name: "Grok Fast" },
            ],
          },
          configOptions: modelConfig().filter((option) => option.category !== "model"),
        }
      : { sessionId, configOptions: modelConfig() };
    write({ id: message.id, result });
    return;
  }
  if (message.method === "session/load") {
    log({ method: message.method, sessionId: message.params.sessionId });
    write({ id: message.id, result: { configOptions: modelConfig() } });
    return;
  }
  if (message.method === "session/close") {
    log({ method: message.method, sessionId: message.params.sessionId });
    write({ id: message.id, result: {} });
    return;
  }
  if (message.method === "_x.ai/billing") {
    log({ method: message.method });
    if (mode === "hung-billing") return;
    write({
      id: message.id,
      result: {
        config: {
          ...(mode === "unified-billing"
            ? { onDemandCap: {}, onDemandUsed: {}, prepaidBalance: {}, isUnifiedBillingUser: true }
            : { creditUsagePercent: 8 }),
          currentPeriod: mode === "monthly-billing"
            ? { periodType: "USAGE_PERIOD_TYPE_MONTHLY", start: "2026-09-01T00:00:00Z", end: "2026-10-01T00:00:00Z" }
            : {
                type: mode === "unified-billing" ? "USAGE_PERIOD_TYPE_WEEKLY" : undefined,
                start: "2026-09-01T00:00:00Z",
                end: "2026-09-08T00:00:00Z",
              },
        },
      },
    });
    return;
  }
  if (message.method === "session/set_config_option") {
    log({ method: message.method, configId: message.params.configId, value: message.params.value });
    const configOptions = modelConfig().map((option) => option.id === message.params.configId ? { ...option, currentValue: message.params.value } : option);
    write({ id: message.id, result: { configOptions } });
    return;
  }
  if (message.method === "session/set_model") {
    log({
      method: message.method,
      modelId: message.params.modelId,
      reasoningEffort: message.params._meta?.reasoningEffort,
    });
    write({ id: message.id, result: {} });
    return;
  }
  if (message.method === "session/prompt") {
    if (mode.startsWith("opencode-")) {
      promptCounter += 1;
      const update = promptCounter > 1
        ? { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Reply after retry." } }
        : mode === "opencode-tools"
          ? { sessionUpdate: "tool_call", toolCallId: "read-1", title: "Read files", status: "completed" }
          : mode === "opencode-thought"
            ? { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Thinking." } }
            : mode === "opencode-whitespace" || mode === "opencode-answer"
              ? { sessionUpdate: "agent_message_chunk", content: { type: "text", text: mode === "opencode-answer" ? "Answer." : "   " } }
              : null;
      if (update) write({ method: "session/update", params: { sessionId: message.params.sessionId, update } });
      write({ id: message.id, result: { stopReason: promptCounter === 1 && mode === "opencode-cancel" ? "cancelled" : "end_turn" } });
      return;
    }
    if (["end_turn", "cancelled", "max_tokens"].includes(mode)) {
      const updates = [
        { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Planning inspection." } },
        { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Inspecting files." } },
        { sessionUpdate: "tool_call", toolCallId: "read-1", title: "Read files", status: "in_progress" },
        { sessionUpdate: "tool_call_update", toolCallId: "read-1", status: "completed" },
        { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Reviewing findings." } },
        { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Checking results." } },
        { sessionUpdate: "tool_call", toolCallId: "read-2", title: "Check results", status: "in_progress" },
        { sessionUpdate: "tool_call_update", toolCallId: "read-2", status: "completed" },
        { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "The final " } },
        { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "answer." } },
      ];
      for (const update of updates) write({ method: "session/update", params: { sessionId: message.params.sessionId, update } });
      write({ id: message.id, result: { stopReason: mode, usage: { totalTokens: 350, inputTokens: 300, outputTokens: 50, cachedReadTokens: 200, cachedWriteTokens: 0 } } });
      return;
    }
    promptCounter += 1;
    log({ method: message.method, promptCounter, text: message.params.prompt.filter((block) => block.type === "text").map((block) => block.text).join("\n") });
    if (promptCounter === 1) {
      pendingPrompt = { id: message.id, sessionId: message.params.sessionId };
      write({
        id: "permission-1",
        method: "session/request_permission",
        params: {
          sessionId: message.params.sessionId,
          toolCall: { toolCallId: "tool-1", title: "Run tests", kind: "execute", rawInput: { command: "bun test" } },
          options: [
            { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
            { optionId: "reject-once", name: "Reject", kind: "reject_once" },
          ],
        },
      });
    } else if (promptCounter === 2) {
      write({ id: message.id, result: { stopReason: "end_turn" } });
    } else {
      pendingPrompt = { id: message.id, sessionId: message.params.sessionId };
    }
    return;
  }
  if (message.method === "session/cancel") {
    log({ method: message.method, sessionId: message.params.sessionId });
    if (pendingPrompt) {
      write({ id: pendingPrompt.id, result: { stopReason: "cancelled" } });
      pendingPrompt = null;
    }
    if (message.id !== undefined) write({ id: message.id, result: {} });
  }
});
`;
