import { AcpAgentClient } from "./acp-client";

import { NO_PROVIDER_CREDENTIALS, requireProviderDriver } from "./provider-drivers";
// @vitest-environment node

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runCauseEffect } from "./effect-boundary";
import { GrokAgentClient } from "./grok-client";
import { OpenBotDatabase } from "./openbot-database";
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
import { providerHistoryPersistence } from "./provider-history-persistence";

let root: string;
/**
 * The fake agent, written once for this file and not once for each test. macOS checks an executable
 * the first time it runs from a new path, and that check cost about 200 ms in each test that wrote
 * its own copy. The agent reads its mode and its log path from the environment.
 */
let executableRoot: string;
let executable: string;
let logPath: string;
let client: AcpAgentClient | null = null;
let historyDatabase: OpenBotDatabase | null = null;

beforeAll(async () => {
  executableRoot = await mkdtemp(join(tmpdir(), "openbot-grok-acp-cli-"));
  executable = join(executableRoot, "grok");
  await writeFile(executable, FAKE_GROK_ACP, { mode: 0o700 });
});

afterAll(async () => {
  await rm(executableRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "openbot-grok-acp-"));
  historyDatabase = new OpenBotDatabase(join(root, "history"));
  await runCauseEffect(historyDatabase.initialize());
  logPath = join(root, "fake-grok.jsonl");
  process.env.OPENBOT_FAKE_GROK_LOG = logPath;
  delete process.env.OPENBOT_FAKE_GROK_MODE;
});

afterEach(async () => {
  if (client) await runCauseEffect(client.stop());
  client = null;
  historyDatabase?.close();
  historyDatabase = null;
  delete process.env.OPENBOT_FAKE_GROK_LOG;
  delete process.env.OPENBOT_FAKE_GROK_MODE;
  delete process.env.OPENBOT_FAKE_OPENCODE_ERROR;
  await rm(root, { recursive: true, force: true });
});

function historyFor(provider: "grok" | "opencode") {
  if (!historyDatabase) throw new Error("The test history database is not initialized.");
  return providerHistoryPersistence(historyDatabase, provider);
}

function bindHistorySession(threadId: string, provider: "grok" | "opencode"): void {
  if (!historyDatabase) throw new Error("The test history database is not initialized.");
  historyDatabase.connection
    .prepare(
      `INSERT OR IGNORE INTO projection_threads
         (thread_id, agent_id, title, active_turn_id, created_at, updated_at, last_event_sequence)
       VALUES (?, ?, ?, NULL, ?, ?, 0)`,
    )
    .run(threadId, "history-test-agent", "History test", new Date().toISOString(), new Date().toISOString());
  historyDatabase.bindProviderSession({
    threadId,
    provider,
    externalSessionId: threadId,
    model: "test-model",
    effort: "medium",
  });
}

describe.sequential("GrokAgentClient", () => {
  it("runs OpenCode ACP without Grok authentication or billing and preserves its resumed session", async () => {
    client = new AcpAgentClient({ executable, version: "1.0.0" }, 5_000, {
      provider: "opencode",
      argv: ["acp"],
      env: {},
      signInMessage: "Connect OpenCode.",
    });
    client.start();
    await runCauseEffect(client.request("initialize", {}, decodeRecordResponse));
    expect((await runCauseEffect(client.request("account/read", {}, decodeAccountReadResult))).account?.type).toBe(
      "opencode",
    );
    expect(
      await runCauseEffect(client.request("account/rateLimits/read", {}, decodeAccountRateLimitsReadResult)),
    ).toEqual({
      rateLimits: null,
      rateLimitsByLimitId: null,
    });
    const resumed = await runCauseEffect(
      client.request(
        "thread/resume",
        { threadId: "existing-opencode-session", cwd: root, dynamicTools: [] },
        decodeThreadResponse,
      ),
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
      history: historyFor("opencode"),
    });
    const notifications: AppServerNotification[] = [];
    client.on("notification", (event) => notifications.push(event));
    client.start();
    const { thread } = await runCauseEffect(client.request("thread/start", { cwd: root }, decodeThreadResponse));
    bindHistorySession(thread.id, "opencode");
    await runCauseEffect(
      client.request(
        "turn/start",
        { threadId: thread.id, input: [{ type: "text", text: "Answer" }] },
        decodeTurnResponse,
      ),
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
    await runCauseEffect(
      client.request(
        "turn/start",
        { threadId: thread.id, input: [{ type: "text", text: "Retry" }] },
        decodeTurnResponse,
      ),
    );
    await waitFor(() => notifications.some((event) => event.method === "turn/completed"));
    const history = await runCauseEffect(
      client.request("thread/read", { threadId: thread.id, includeTurns: true }, decodeThreadResponse),
    );
    expect(history.thread.turns?.map((turn) => turn.status)).toEqual([status, "completed"]);
    expect(history.thread.turns?.[1]?.items).toContainEqual(expect.objectContaining({ text: "Reply after retry." }));
  });

  it("uses external sign-in for OpenCode and creates its ACP process", async () => {
    const driver = requireProviderDriver("opencode");
    expect(driver.signIn).toEqual({ kind: "external" });
    const providerClient = driver.createClient({ executable, version: "1.0.0" }, 5_000, NO_PROVIDER_CREDENTIALS);
    providerClient.start();
    try {
      await runCauseEffect(providerClient.request("initialize", {}, decodeRecordResponse));
      expect(
        (await runCauseEffect(providerClient.request("account/read", {}, decodeAccountReadResult))).account?.type,
      ).toBe("opencode");
    } finally {
      await runCauseEffect(providerClient.stop());
    }
  });

  // Google rejects a key with "API key not valid" (#1388).
  it.each(["Invalid API key.", "API key not valid. Please pass a valid API key."])(
    "explains rejected OpenCode credentials %s and permits retry in the same session",
    async (reason) => {
      process.env.OPENBOT_FAKE_GROK_MODE = "opencode-auth-error";
      process.env.OPENBOT_FAKE_OPENCODE_ERROR = reason;
      client = new AcpAgentClient({ executable, version: "1.18.30" }, 5_000, {
        provider: "opencode",
        argv: ["acp"],
        env: {},
        signInMessage: "Connect OpenCode.",
        history: historyFor("opencode"),
      });
      const notifications: AppServerNotification[] = [];
      client.on("notification", (event) => notifications.push(event));
      client.start();
      const { thread } = await runCauseEffect(client.request("thread/start", { cwd: root }, decodeThreadResponse));
      bindHistorySession(thread.id, "opencode");
      for (const text of ["Try", "Retry"]) {
        await runCauseEffect(
          client.request("turn/start", { threadId: thread.id, input: [{ type: "text", text }] }, decodeTurnResponse),
        );
        await waitFor(
          () => notifications.filter((event) => event.method === "turn/completed").length === (text === "Try" ? 1 : 2),
        );
      }
      expect(notifications.filter((event) => event.method === "error").map((event) => event.params)).toEqual([
        expect.objectContaining({
          message: sourceText("error.provider.opencodeCredentialsRejected", { detail: reason }),
        }),
      ]);
      const history = await runCauseEffect(
        client.request("thread/read", { threadId: thread.id, includeTurns: true }, decodeThreadResponse),
      );
      expect(history.thread.turns?.map((turn) => turn.status)).toEqual(["failed", "completed"]);
    },
  );

  // Only the kind decides whether waiting helps, so a refusal must not read as a lost connection (#1163).
  it.each([
    [
      "Upstream request failed: [rate_limit_exceeded] Rate limit exceeded. Please retry after a brief wait.",
      "opencodeRateLimited",
    ],
    ["Too Many Requests", "opencodeRateLimited"],
    ["No payment method.", "opencodeBilling"],
    ["Upstream request failed: Insufficient account funds", "opencodeBilling"],
    ["Invalid upload request.", "opencodeInvalidUpload"],
    ["Upstream request failed: [invalid_request_error] Invalid upload request.", "opencodeInvalidUpload"],
    ["Upstream request failed: Endpoint is unavailable.", "opencodeProviderFailed"],
    ["Service Unavailable", "opencodeProviderFailed"],
    ["Upstream request failed: Cannot connect to API: Unable to connect.", "opencodeProviderFailed"],
    ["Cannot connect to API: Unable to connect.", "opencodeNetwork"],
  ] as const)("names the kind of the OpenCode request failure %s", async (reason, kind) => {
    process.env.OPENBOT_FAKE_GROK_MODE = "opencode-request-error";
    process.env.OPENBOT_FAKE_OPENCODE_ERROR = reason;
    client = new AcpAgentClient({ executable, version: "1.18.30" }, 5_000, {
      provider: "opencode",
      argv: ["acp"],
      env: {},
      signInMessage: "Connect OpenCode.",
    });
    const notifications: AppServerNotification[] = [];
    client.on("notification", (event) => notifications.push(event));
    client.start();
    const { thread } = await runCauseEffect(client.request("thread/start", { cwd: root }, decodeThreadResponse));
    await runCauseEffect(
      client.request("turn/start", { threadId: thread.id, input: [{ type: "text", text: "Try" }] }, decodeTurnResponse),
    );
    await waitFor(() => notifications.some((event) => event.method === "turn/completed"));
    expect(notifications.filter((event) => event.method === "error").map((event) => event.params)).toEqual([
      expect.objectContaining({ message: sourceText(`error.provider.${kind}`, { detail: reason }) }),
    ]);
  });

  it.each(["grok", "opencode"] as const)("keeps %s tool names when completion updates omit them", async (provider) => {
    process.env.OPENBOT_FAKE_GROK_MODE = "end_turn";
    client = new AcpAgentClient({ executable, version: "1.18.30" }, 5_000, {
      provider,
      argv: ["acp"],
      env: {},
      signInMessage: "Connect the provider.",
    });
    const notifications: AppServerNotification[] = [];
    client.on("notification", (event) => notifications.push(event));
    client.start();
    const { thread } = await runCauseEffect(client.request("thread/start", { cwd: root }, decodeThreadResponse));
    await runCauseEffect(
      client.request(
        "turn/start",
        { threadId: thread.id, input: [{ type: "text", text: "Inspect" }] },
        decodeTurnResponse,
      ),
    );
    await waitFor(() => notifications.some((event) => event.method === "turn/completed"));
    const tools = notifications.flatMap((event) => {
      if (event.method !== "item/completed" || !isDynamicRecord(event.params) || !isDynamicRecord(event.params.item))
        return [];
      return event.params.item.type === "toolCall" ? [event.params.item.name] : [];
    });
    expect(tools).toEqual(["Read files", "Read more", "Check results"]);
  });

  it("starts profile generation with no built-in tools and denies approval requests", async () => {
    client = new GrokAgentClient({ executable, version: "1.0.5" }, 5_000, true);
    const requests: AppServerRequest[] = [];
    client.on("request", (request) => requests.push(request));
    client.start();
    await runCauseEffect(client.request("initialize", {}, decodeRecordResponse));
    const thread = await runCauseEffect(
      client.request("thread/start", { cwd: root, dynamicTools: [] }, decodeThreadResponse),
    );
    await runCauseEffect(
      client.request(
        "turn/start",
        { threadId: thread.thread.id, input: [{ type: "text", text: "Draft a profile" }] },
        decodeTurnResponse,
      ),
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
      client = new GrokAgentClient(
        { executable, version: "1.0.5" },
        5_000,
        false,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        historyFor("grok"),
      );
      const notifications: AppServerNotification[] = [];
      client.on("notification", (notification) => notifications.push(notification));
      client.start();
      const { thread } = await runCauseEffect(client.request("thread/start", { cwd: root }, decodeThreadResponse));
      bindHistorySession(thread.id, "grok");
      await runCauseEffect(
        client.request(
          "turn/start",
          { threadId: thread.id, input: [{ type: "text", text: "Inspect and answer" }] },
          decodeTurnResponse,
        ),
      );
      await waitFor(() => notifications.some((notification) => notification.method === "turn/completed"));
      expect(notifications.find((event) => event.method === "openbot/usage")?.params).toMatchObject({
        usage: { inputTokens: 300, outputTokens: 50, cachedReadTokens: 200 },
      });
      const history = await runCauseEffect(
        client.request("thread/read", { threadId: thread.id, includeTurns: true }, decodeThreadResponse),
      );
      const messages = history.thread.turns?.[0]?.items?.filter((item) => item.type === "agentMessage");
      expect(messages).toEqual([
        expect.objectContaining({ phase: "commentary", text: "Planning inspection." }),
        expect.objectContaining({ phase: "commentary", text: "Inspecting files." }),
        expect.objectContaining({ phase: "commentary", text: "Reviewing findings." }),
        // A tool call between two thoughts keeps them apart (#1540).
        expect.objectContaining({ phase: "commentary", text: "Comparing results." }),
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
      expect([...texts.values()]).toEqual(["Planning inspection.", "Reviewing findings.", "Comparing results."]);
      expect(streamedThoughts).toEqual(["Reviewing findings."]);
      expect(completedAnswers).toEqual(["The final answer."]);
      expect([...phases.values()].filter((phase) => phase === "final_answer")).toHaveLength(1);
    },
  );

  it("refuses steering without sending a second prompt or completing the running turn", async () => {
    process.env.OPENBOT_FAKE_GROK_MODE = "busy-steer";
    client = new GrokAgentClient(
      { executable, version: "1.0.5" },
      5_000,
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      historyFor("grok"),
    );
    const notifications: AppServerNotification[] = [];
    const diagnostics: string[] = [];
    client.on("notification", (notification) => notifications.push(notification));
    client.on("diagnostic", (message: string) => diagnostics.push(message));
    client.start();
    const { thread } = await runCauseEffect(client.request("thread/start", { cwd: root }, decodeThreadResponse));
    bindHistorySession(thread.id, "grok");
    await runCauseEffect(
      client.request(
        "turn/start",
        { threadId: thread.id, clientUserMessageId: "turn-1", input: [{ type: "text", text: "Build it" }] },
        decodeTurnResponse,
      ),
    );
    await expect(
      runCauseEffect(
        client.request(
          "turn/steer",
          { threadId: thread.id, expectedTurnId: "turn-1", input: [{ type: "text", text: "Also add tests" }] },
          decodeRecordResponse,
        ),
      ),
    ).rejects.toThrow(sourceText("error.backend.steerUnsupported"));
    await expectLogged({ method: "session/prompt", text: "Build it" });
    expect(notifications.some((notification) => notification.method === "turn/completed")).toBe(false);
    await runCauseEffect(
      client.request("turn/interrupt", { threadId: thread.id, turnId: "turn-1" }, decodeRecordResponse),
    );
    await waitFor(() => notifications.some((notification) => notification.method === "turn/completed"));

    const completed = notifications.filter((notification) => notification.method === "turn/completed");
    expect(completed.map((notification) => notification.params)).toEqual([
      { threadId: thread.id, turn: { id: "turn-1", status: "interrupted" } },
    ]);
    const prompts = (await readFile(logPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
      .filter((entry) => entry.method === "session/prompt")
      .map((entry) => entry.text);
    expect(prompts).toEqual(["Build it"]);
    const history = await runCauseEffect(
      client.request("thread/read", { threadId: thread.id, includeTurns: true }, decodeThreadResponse),
    );
    expect(history.thread.turns?.[0]?.items).toEqual([
      expect.objectContaining({ phase: "final_answer", text: "First answer." }),
    ]);
    expect(diagnostics.filter((message) => message.includes("ACP steer failed"))).toEqual([]);
  });

  it("reads the current weekly billing period and a monthly period", async () => {
    client = new GrokAgentClient({ executable, version: "1.0.5" }, 5_000);
    client.start();
    await runCauseEffect(client.request("initialize", {}, decodeRecordResponse));
    await expect(
      runCauseEffect(
        client.request("account/rateLimits/read", { model: "grok-4.5" }, decodeAccountRateLimitsReadResult),
      ),
    ).resolves.toMatchObject({
      rateLimits: {
        secondary: { usedPercent: 8, windowDurationMins: 10_080, resetsAt: 1_788_825_600 },
      },
    });
    await runCauseEffect(client.stop());

    process.env.OPENBOT_FAKE_GROK_MODE = "monthly-billing";
    client = new GrokAgentClient({ executable, version: "1.0.5" }, 5_000);
    client.start();
    await runCauseEffect(client.request("initialize", {}, decodeRecordResponse));
    await expect(
      runCauseEffect(
        client.request("account/rateLimits/read", { model: "grok-4.5" }, decodeAccountRateLimitsReadResult),
      ),
    ).resolves.toMatchObject({
      rateLimits: {
        secondary: { usedPercent: 8, windowDurationMins: 43_200 },
      },
    });
  });

  it("reads a unified weekly billing period with no usage as 0% used", async () => {
    // proto3 JSON omits a zero `creditUsagePercent`; Grok 1.0.46 sends this shape before any use.
    process.env.OPENBOT_FAKE_GROK_MODE = "unified-billing";
    client = new GrokAgentClient({ executable, version: "1.0.13" }, 5_000);
    client.start();
    await runCauseEffect(client.request("initialize", {}, decodeRecordResponse));

    await expect(
      runCauseEffect(
        client.request("account/rateLimits/read", { model: "grok-4.5" }, decodeAccountRateLimitsReadResult),
      ),
    ).resolves.toMatchObject({
      rateLimits: { secondary: { usedPercent: 0, windowDurationMins: 10_080, resetsAt: 1_788_825_600 } },
    });
  });

  it("times out a billing request that stops responding", async () => {
    process.env.OPENBOT_FAKE_GROK_MODE = "hung-billing";
    client = new GrokAgentClient({ executable, version: "1.0.13" }, 1_000);
    client.start();
    await runCauseEffect(client.request("initialize", {}, decodeRecordResponse));

    await expect(
      runCauseEffect(
        client.request("account/rateLimits/read", { model: "grok-4.5" }, decodeAccountRateLimitsReadResult),
      ),
    ).rejects.toThrow("Grok request timed out: account/rateLimits/read");
  });

  it.each(["grok", "opencode"] as const)(
    "%s discovers models, streams, refuses steering, asks, approves, cancels, and resumes",
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

      await runCauseEffect(client.request("initialize", {}, decodeRecordResponse));
      await expect(runCauseEffect(client.request("account/read", {}, decodeAccountReadResult))).resolves.toMatchObject({
        account: { type: provider, email: provider === "grok" ? "grok@example.com" : null },
      });
      const models = await runCauseEffect(client.request("model/list", {}, decodeModelListResponse));
      expect(models.data).toEqual([
        expect.objectContaining({
          model: "grok-4.5",
          defaultReasoningEffort: "xhigh",
          supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "xhigh" }],
        }),
        expect.objectContaining({ model: "grok-fast" }),
      ]);

      const started = await runCauseEffect(
        client.request(
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
        ),
      );
      const threadId = started.thread.id;
      const imagePath = join(root, "input.png");
      const imageData = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9X8AAAAASUVORK5CYII=";
      await writeFile(imagePath, Buffer.from(imageData, "base64"));
      const turn = await runCauseEffect(
        client.request(
          "turn/start",
          {
            threadId,
            model: "grok-fast",
            effort: "xhigh",
            clientUserMessageId: "turn-1",
            input: [
              { type: "text", text: "Build it" },
              { type: "localImage", path: imagePath },
            ],
          },
          decodeTurnResponse,
        ),
      );
      expect(turn.turn.status).toBe("inProgress");
      await waitFor(() => requests.some((request) => request.method.includes("requestApproval")));

      await expect(
        runCauseEffect(
          client.request(
            "turn/steer",
            {
              threadId,
              expectedTurnId: "turn-1",
              input: [{ type: "text", text: "Also add tests" }],
            },
            decodeRecordResponse,
          ),
        ),
      ).rejects.toThrow(sourceText("error.backend.steerUnsupported"));
      expect((await readLog()).filter((entry) => entry.method === "session/prompt")).toHaveLength(1);
      expect(notifications.some((notification) => notification.method === "turn/completed")).toBe(false);
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

      const secondTurn = await runCauseEffect(
        client.request(
          "turn/start",
          { threadId, clientUserMessageId: "turn-2", input: [{ type: "text", text: "Wait" }] },
          decodeTurnResponse,
        ),
      );
      await runCauseEffect(
        client.request("turn/interrupt", { threadId, turnId: secondTurn.turn.id }, decodeRecordResponse),
      );
      await waitFor(() =>
        notifications.some(
          (notification) =>
            notification.method === "turn/completed" &&
            JSON.stringify(notification.params).includes('"status":"interrupted"'),
        ),
      );

      const log = await readLog();
      expect(log).toContainEqual(
        expect.objectContaining({
          method: "session/prompt",
          images: [{ type: "image", data: imageData, mimeType: "image/png", uri: imagePath }],
        }),
      );
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

      await runCauseEffect(client.stop());
      client = createClient();
      client.start();
      await runCauseEffect(client.request("initialize", {}, decodeRecordResponse));
      await expect(
        runCauseEffect(
          client.request("thread/resume", { threadId, cwd: root, dynamicTools: [] }, decodeRecordResponse),
        ),
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
    await runCauseEffect(client.request("initialize", {}, decodeRecordResponse));
    const models = await runCauseEffect(client.request("model/list", {}, decodeModelListResponse));
    expect(models.data).toContainEqual(expect.objectContaining({ model: "grok-future-2", displayName: "Future Grok" }));
    await expectLogged({ method: "session/close", sessionId: "grok-session-2" });
    await expect(runCauseEffect(client.request("model/list", {}, decodeModelListResponse))).rejects.toThrow(
      "Discovery unavailable",
    );
    const refreshed = await runCauseEffect(client.request("model/list", {}, decodeModelListResponse));
    expect(refreshed.data.map((model) => model.model)).toEqual(["grok-4.5", "grok-fast", "grok-future-4"]);
    await expectLogged({ method: "session/close", sessionId: "grok-session-4" });
  });

  it("bounds Grok model discovery by the caller timeout", async () => {
    process.env.OPENBOT_FAKE_GROK_MODE = "hung-models";
    client = new GrokAgentClient({ executable, version: "1.0.13" }, 5_000);
    client.start();
    await runCauseEffect(client.request("initialize", {}, decodeRecordResponse));
    await expect(runCauseEffect(client.request("model/list", {}, decodeModelListResponse, 10))).rejects.toThrow(
      "Grok request timed out: model/list",
    );
  });

  it("uses one neutral effort when thought_level is not advertised", async () => {
    process.env.OPENBOT_FAKE_GROK_MODE = "no-thought";
    client = new GrokAgentClient({ executable, version: "1.0.5" }, 5_000);
    client.start();
    await runCauseEffect(client.request("initialize", {}, decodeRecordResponse));
    const models = await runCauseEffect(client.request("model/list", {}, decodeModelListResponse));
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
    await runCauseEffect(client.request("initialize", {}, decodeRecordResponse));

    const models = await runCauseEffect(client.request("model/list", {}, decodeModelListResponse));
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

    await runCauseEffect(
      client.request(
        "thread/start",
        { cwd: root, dynamicTools: [], model: "grok-4.6", effort: "xhigh" },
        decodeThreadResponse,
      ),
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
    await runCauseEffect(
      client.request(
        "thread/start",
        { cwd: root, dynamicTools: [], model: "grok-4.5", effort: "medium" },
        decodeThreadResponse,
      ),
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
    await runCauseEffect(client.request("initialize", {}, decodeRecordResponse));
    const models = await runCauseEffect(client.request("model/list", {}, decodeModelListResponse));
    expect(models.data).toEqual([
      expect.objectContaining({ model: "grok-4.5", displayName: "Grok 4.5" }),
      expect.objectContaining({ model: "grok-fast", displayName: "Grok Fast" }),
    ]);

    await runCauseEffect(
      client.request(
        "thread/start",
        { cwd: root, dynamicTools: [], model: "grok-fast", effort: "xhigh" },
        decodeThreadResponse,
      ),
    );
    expect(await readLog()).toEqual(
      expect.arrayContaining([expect.objectContaining({ method: "session/set_model", modelId: "grok-fast" })]),
    );
  });

  it("reports auth as signed out and rejects empty model discovery without a fallback", async () => {
    process.env.OPENBOT_FAKE_GROK_MODE = "auth-error";
    client = new GrokAgentClient({ executable, version: "1.0.5" }, 5_000);
    client.start();
    await runCauseEffect(client.request("initialize", {}, decodeRecordResponse));
    await expect(runCauseEffect(client.request("account/read", {}, decodeAccountReadResult))).resolves.toMatchObject({
      account: null,
    });
    expect((await readLog()).some((entry) => entry.method === "_x.ai/auth/info")).toBe(false);
    await runCauseEffect(client.stop());

    process.env.OPENBOT_FAKE_GROK_MODE = "no-model";
    client = new GrokAgentClient({ executable, version: "1.0.5" }, 5_000);
    client.start();
    await expect(runCauseEffect(client.request("initialize", {}, decodeRecordResponse))).rejects.toThrow(
      "did not advertise any ACP models",
    );
  });

  it.each(["unsupported-auth-info", "malformed-auth-info", "oversized-auth-info"])(
    "keeps Grok signed in when account identity is %s",
    async (mode) => {
      process.env.OPENBOT_FAKE_GROK_MODE = mode;
      client = new GrokAgentClient({ executable, version: "1.0.22" }, 5_000);
      client.start();
      await runCauseEffect(client.request("initialize", {}, decodeRecordResponse));

      await expect(runCauseEffect(client.request("account/read", {}, decodeAccountReadResult))).resolves.toEqual({
        account: { type: "grok", email: null, planType: null },
        requiresOpenaiAuth: false,
      });
      expect(await readLog()).toContainEqual(expect.objectContaining({ method: "_x.ai/auth/info" }));
    },
  );
});

/** Discovery closes its session in the background after `model/list` returns, so wait for the close. */
async function expectLogged(entry: DynamicRecord): Promise<void> {
  await vi.waitFor(async () => expect(await readLog()).toContainEqual(entry), { timeout: 3_000 });
}

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
        write({ id: message.id, error: { code: -32603, message: "Internal error: " + process.env.OPENBOT_FAKE_OPENCODE_ERROR } });
        return;
      }
      if (mode === "opencode-request-error") {
        write({ id: message.id, error: { code: -32603, message: "Internal error: " + process.env.OPENBOT_FAKE_OPENCODE_ERROR, data: { service: "session", errorName: "APIError" } } });
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
    if (mode === "busy-steer") {
      promptCounter += 1;
      log({ method: message.method, text: message.params.prompt.map((block) => block.text).join("\n") });
      const sessionId = message.params.sessionId;
      if (promptCounter === 1) {
        write({ method: "session/update", params: { sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "First answer." } } } });
        pendingPrompt = { id: message.id, sessionId };
      } else if (promptCounter === 2) {
        write({ id: message.id, error: { code: -32603, message: "A prompt is already running for this session" } });
        write({ id: pendingPrompt.id, result: { stopReason: "end_turn" } });
        pendingPrompt = null;
      } else {
        write({ method: "session/update", params: { sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Reply to the steer." } } } });
        write({ id: message.id, result: { stopReason: "end_turn" } });
      }
      return;
    }
    if (["end_turn", "cancelled", "max_tokens"].includes(mode)) {
      const updates = [
        { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Planning inspection." } },
        { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Inspecting files." } },
        { sessionUpdate: "tool_call", toolCallId: "read-1", title: "Read files", status: "in_progress" },
        { sessionUpdate: "tool_call_update", toolCallId: "read-1", status: "completed" },
        { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Reviewing findings." } },
        { sessionUpdate: "tool_call", toolCallId: "read-3", title: "Read more", status: "in_progress" },
        { sessionUpdate: "tool_call_update", toolCallId: "read-3", status: "completed" },
        { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Comparing results." } },
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
