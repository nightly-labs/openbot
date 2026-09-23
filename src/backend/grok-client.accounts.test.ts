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
  decodeAccountRateLimitsReadResult,
  decodeAccountReadResult,
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

describe.sequential("GrokAgentClient: sign-in and billing", () => {
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

  it("explains rejected OpenCode credentials and permits retry in the same session", async () => {
    process.env.OPENBOT_FAKE_GROK_MODE = "opencode-auth-error";
    client = new AcpAgentClient({ executable, version: "1.18.30" }, 5_000, {
      provider: "opencode",
      argv: ["acp"],
      env: {},
      signInMessage: "Connect OpenCode.",
    });
    const notifications: AppServerNotification[] = [];
    client.on("notification", (event) => notifications.push(event));
    client.start();
    const { thread } = await client.request("thread/start", { cwd: root }, decodeThreadResponse);
    for (const text of ["Try", "Retry"]) {
      await client.request("turn/start", { threadId: thread.id, input: [{ type: "text", text }] }, decodeTurnResponse);
      await waitFor(
        () => notifications.filter((event) => event.method === "turn/completed").length === (text === "Try" ? 1 : 2),
      );
    }
    expect(notifications.filter((event) => event.method === "error").map((event) => event.params)).toEqual([
      expect.objectContaining({
        message:
          "OpenCode rejected the selected model's credentials. Update or remove the OpenCode Go key in Settings. If you signed in through the OpenCode CLI, reconnect that provider there. Then retry or choose another model.\nRequestError: Internal error: Invalid API key.",
      }),
    ]);
    const history = await client.request("thread/read", { threadId: thread.id }, decodeThreadResponse);
    expect(history.thread.turns?.map((turn) => turn.status)).toEqual(["failed", "completed"]);
  });

  it("reads the current weekly billing period and a monthly period", async () => {
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
    ).resolves.toMatchObject({
      rateLimits: {
        secondary: { usedPercent: 8, windowDurationMins: 43_200 },
      },
    });
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

  it.each(["unsupported-auth-info", "malformed-auth-info", "oversized-auth-info"])(
    "keeps Grok signed in when account identity is %s",
    async (mode) => {
      process.env.OPENBOT_FAKE_GROK_MODE = mode;
      client = new GrokAgentClient({ executable, version: "1.0.22" }, 5_000);
      client.start();
      await client.request("initialize", {}, decodeRecordResponse);

      await expect(client.request("account/read", {}, decodeAccountReadResult)).resolves.toEqual({
        account: { type: "grok", email: null, planType: null },
        requiresOpenaiAuth: false,
      });
      expect(await readLog()).toContainEqual(expect.objectContaining({ method: "_x.ai/auth/info" }));
    },
  );
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
  if (message.method === "_x.ai/auth/info") {
    log({ method: message.method });
    if (mode === "unsupported-auth-info") {
      write({ id: message.id, error: { code: -32601, message: "Method not found" } });
      return;
    }
    write({
      id: message.id,
      result: { email: mode === "malformed-auth-info" ? 42 : mode === "oversized-auth-info" ? "x".repeat(255) : "grok@example.com" },
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
      if (mode === "opencode-auth-error" && promptCounter === 1) {
        write({ id: message.id, error: { code: -32603, message: "Internal error: Invalid API key." } });
        return;
      }
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
    log({ method: message.method, promptCounter, text: message.params.prompt.filter((block) => block.type === "text").map((block) => block.text).join("\n"), images: message.params.prompt.filter((block) => block.type === "image") });
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
