// @vitest-environment node

import { chmod, mkdtemp, readlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CanUseTool, ModelInfo, SDKUserMessage, SessionMessage } from "@anthropic-ai/claude-agent-sdk";
import type { McpServerConfig } from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AgentStore } from "./agent-store";
import { CLAUDE_IDLE_THREAD_LIMIT, CLAUDE_THREAD_IDLE_RELEASE_MS, ClaudeAgentClient } from "./claude-client";
import { mergeProviderHistory, newAssistantMessage, snapshotFromThread } from "./conversation-snapshots";
import { loginShellPath } from "./mcp-provider-shapes";
import { OPENBOT_DYNAMIC_TOOLS } from "./openbot-tools";
import { isPathInside } from "./path-containment";
import {
  decodeAccountRateLimitsReadResult,
  decodeAccountReadResult,
  decodeModelListResponse,
  decodeRecordResponse,
  decodeThreadResponse,
  decodeTurnResponse,
  getRecord,
  getString,
} from "./protocol";

type TestStreamMessage =
  | {
      type: "stream_event";
      parent_tool_use_id: null;
      session_id: string;
      uuid: string;
      event: {
        type: "content_block_delta";
        index: number;
        delta: { type: "text_delta"; text: string } | { type: "thinking_delta"; thinking: string };
      };
    }
  | {
      type: "assistant";
      parent_tool_use_id: string | null;
      session_id: string;
      uuid: string;
      message: {
        content: Array<{
          type: string;
          text?: string;
          thinking?: string;
          id?: string;
          name?: string;
          tool_use_id?: string;
        }>;
      };
    }
  | {
      type: "user";
      parent_tool_use_id: string | null;
      session_id: string;
      uuid: string;
      message: { content: Array<{ type: "tool_result"; tool_use_id: string }> };
    }
  | {
      type: "result";
      modelUsage?: Record<
        string,
        {
          inputTokens: number;
          outputTokens: number;
          cacheReadInputTokens: number;
          cacheCreationInputTokens: number;
          costUSD: number;
        }
      >;
      total_cost_usd?: number;
      subtype: "success";
      result: string;
      terminal_reason: "completed";
      errors: string[];
      session_id: string;
      uuid: string;
    };

let root: string | null = null;

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = null;
});

describe("ClaudeAgentClient", () => {
  it("prefers the active model family weekly limit and falls back to the all-model limit", async () => {
    const usage = {
      rate_limits_available: true,
      rate_limits: {
        five_hour: { utilization: 12, resets_at: "2026-09-03T16:00:00Z" },
        seven_day: { utilization: 34, resets_at: "2026-09-08T00:00:00Z" },
        seven_day_sonnet: { utilization: 82, resets_at: "2026-09-09T00:00:00Z" },
        model_scoped: [{ display_name: "haiku", utilization: 91, resets_at: "2026-09-03T16:00:00Z" }],
      },
    };
    const client = new ClaudeAgentClient(
      { executable: "/bin/true", version: "2.1.246" },
      () => new TestQuery(new TestQueue<TestStreamMessage>(), [], usage),
    );
    client.start();

    await expect(
      client.request("account/rateLimits/read", { model: "claude-sonnet-4-6" }, decodeAccountRateLimitsReadResult),
    ).resolves.toMatchObject({
      rateLimits: {
        primary: { usedPercent: 12, windowDurationMins: 300 },
        secondary: { usedPercent: 82, windowDurationMins: 10_080 },
      },
    });
    await expect(
      client.request("account/rateLimits/read", { model: "claude-haiku-4-5" }, decodeAccountRateLimitsReadResult),
    ).resolves.toMatchObject({
      rateLimits: { secondary: { usedPercent: 34, windowDurationMins: 10_080 } },
    });
    await client.stop();
  });

  it("starts no MCP server to list models or read usage", async () => {
    const probes: DynamicRecord[] = [];
    const client = new ClaudeAgentClient({ executable: "/bin/true", version: "2.1.251" }, (params) => {
      if (isDynamicRecord(params.options)) probes.push(params.options);
      return new TestQuery(new TestQueue<TestStreamMessage>(), [], { rate_limits_available: false });
    });
    client.start();

    await client.request("model/list", {}, decodeModelListResponse);
    await client.request("account/rateLimits/read", { model: "claude-sonnet-4-6" }, decodeAccountRateLimitsReadResult);

    expect(probes).toHaveLength(2);
    for (const options of probes) expect(options).toMatchObject({ mcpServers: {}, strictMcpConfig: true });
    await client.stop();
  });

  it("times out usage discovery and closes its query", async () => {
    const query = new TestQuery(new TestQueue<TestStreamMessage>(), [], new Promise<unknown>(() => undefined));
    const client = new ClaudeAgentClient({ executable: "/bin/true", version: "2.1.246" }, () => query, undefined, 10);
    client.start();

    await expect(
      client.request("account/rateLimits/read", { model: "claude-sonnet-4-6" }, decodeAccountRateLimitsReadResult),
    ).rejects.toThrow("Claude request timed out: account/rateLimits/read");
    expect(query.closed).toBe(true);
    await client.stop();
  });

  it("restores one stable reasoning item for a multi-phase turn", async () => {
    const turnId = "8bf58506-96a8-4d96-837c-3ab807b79d1f";
    const history: SessionMessage[] = [
      {
        type: "user",
        uuid: turnId,
        session_id: "thread-1",
        parent_tool_use_id: null,
        parent_agent_id: null,
        message: { content: "Plan it" },
      },
      {
        type: "assistant",
        uuid: "phase-1",
        session_id: "thread-1",
        parent_tool_use_id: null,
        parent_agent_id: null,
        message: { content: [{ type: "thinking", thinking: "Check the inputs." }] },
      },
      {
        type: "assistant",
        uuid: "phase-2",
        session_id: "thread-1",
        parent_tool_use_id: null,
        parent_agent_id: null,
        message: { content: [{ type: "thinking", thinking: "Compare the options." }] },
      },
      {
        type: "assistant",
        uuid: "answer",
        session_id: "thread-1",
        parent_tool_use_id: null,
        parent_agent_id: null,
        message: { content: [{ type: "text", text: "Use option A." }] },
      },
    ];
    const client = new ClaudeAgentClient(
      { executable: "/bin/true", version: "2.1.231" },
      undefined,
      async () => history,
    );
    client.start();

    const result = await client.request("thread/read", { threadId: "thread-1" }, decodeThreadResponse);

    expect(result.thread.turns?.[0]?.items).toEqual([
      expect.objectContaining({ type: "userMessage" }),
      {
        id: `${turnId}:reasoning`,
        type: "agentMessage",
        phase: "commentary",
        text: "Check the inputs.\nCompare the options.",
      },
      { id: "answer", type: "agentMessage", text: "Use option A." },
    ]);
    await client.stop();
  });

  it("streams a Claude SDK turn through the App Server event contract", async () => {
    root = await mkdtemp(join(tmpdir(), "openbot-claude-client-"));
    const sharedRoot = join(root, "shared");
    const executable = join(root, "claude");
    await writeFile(
      executable,
      `#!/bin/sh
if [ "$1" = "auth" ]; then
  printf '%s' '{"loggedIn":true,"email":"claude@example.com","subscriptionType":"max"}'
fi
`,
    );
    await chmod(executable, 0o755);

    const output = new TestQueue<TestStreamMessage>();
    let prompt: AsyncIterable<SDKUserMessage> | null = null;
    const generator = new TestQuery(output);
    const client = new ClaudeAgentClient({ executable, version: "2.1.231" }, (params) => {
      if (!isString(params.prompt)) prompt = params.prompt;
      expect(params.options).toMatchObject({
        cwd: root,
        permissionMode: "default",
        additionalDirectories: [root, sharedRoot],
      });
      const options: DynamicRecord | null = isDynamicRecord(params.options) ? params.options : null;
      const mcpServers: DynamicRecord | null = isDynamicRecord(options?.mcpServers) ? options.mcpServers : null;
      const browserServer = mcpServers?.openbot_browser;
      const browserServerInstance = isDynamicRecord(browserServer) ? browserServer.instance : null;
      const registeredBrowserTools = isDynamicRecord(browserServerInstance)
        ? browserServerInstance._registeredTools
        : null;
      expect(isDynamicRecord(registeredBrowserTools) ? Object.keys(registeredBrowserTools) : []).toEqual(
        expect.arrayContaining(["evaluate", "request_takeover"]),
      );
      const openbotServer = mcpServers?.openbot;
      const serverInstance = isDynamicRecord(openbotServer) ? openbotServer.instance : null;
      const registeredTools = isDynamicRecord(serverInstance) ? serverInstance._registeredTools : null;
      // Compare the declarations passed to the providers, including schema constraints and guidance.
      // Claude uses the SDK's AskUserQuestion instead of the ask_user MCP tool.
      const expectedTools = OPENBOT_DYNAMIC_TOOLS.tools.filter((dynamicTool) => dynamicTool.name !== "ask_user");
      expect((isDynamicRecord(registeredTools) ? Object.keys(registeredTools) : []).toSorted()).toEqual(
        expectedTools.map((dynamicTool) => dynamicTool.name).toSorted(),
      );
      for (const dynamicTool of expectedTools) {
        const registered = isDynamicRecord(registeredTools) ? registeredTools[dynamicTool.name] : null;
        const inputSchema = isDynamicRecord(registered) ? registered.inputSchema : null;
        expect(isDynamicRecord(registered) ? registered.description : null).toBe(dynamicTool.description);
        expect(
          inputSchema instanceof z.core.$ZodObject ? z.toJSONSchema(inputSchema, { target: "draft-7" }) : null,
        ).toEqual(dynamicTool.inputSchema);
      }
      return generator;
    });
    const notifications: Array<{ method: string; params: unknown }> = [];
    client.on("notification", (notification) => notifications.push(notification));
    client.start();

    await expect(client.request("account/read", {}, decodeAccountReadResult)).resolves.toMatchObject({
      account: { type: "claude", email: "claude@example.com", planType: "max" },
    });
    const thread = await client.request(
      "thread/start",
      {
        cwd: root,
        model: "claude-sonnet-5",
        developerInstructions: "Be concise.",
        runtimeWorkspaceRoots: [root, sharedRoot],
      },
      decodeThreadResponse,
    );
    const deliveryId = "8bf58506-96a8-4d96-837c-3ab807b79d1f";
    await client.request(
      "turn/start",
      {
        threadId: thread.thread.id,
        clientUserMessageId: deliveryId,
        input: [{ type: "text", text: "Hello" }],
      },
      decodeTurnResponse,
    );

    if (prompt === null) throw new Error("Claude prompt was not initialized.");
    const promptStream: AsyncIterable<SDKUserMessage> = prompt;
    let sent: SDKUserMessage | undefined;
    for await (const message of promptStream) {
      sent = message;
      break;
    }
    expect(sent).toMatchObject({ uuid: deliveryId, message: { content: "Hello" } });
    output.push({
      type: "stream_event",
      parent_tool_use_id: null,
      session_id: thread.thread.id,
      uuid: deliveryId,
      event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hi" } },
    });
    output.push({
      type: "stream_event",
      parent_tool_use_id: null,
      session_id: thread.thread.id,
      uuid: deliveryId,
      event: { type: "content_block_delta", index: 1, delta: { type: "thinking_delta", thinking: "Weighing it" } },
    });
    output.push(toolUseMessage(thread.thread.id, "tool-message", "tool-use-1", "WebSearch"));
    output.push(toolResultMessage(thread.thread.id, "tool-result", "tool-use-1"));
    output.push({
      type: "result",
      subtype: "success",
      result: "Hi",
      modelUsage: {
        "claude-sonnet-5": {
          inputTokens: 100,
          outputTokens: 50,
          cacheReadInputTokens: 200,
          cacheCreationInputTokens: 20,
          costUSD: 0.001,
        },
      },
      total_cost_usd: 0.001,
      terminal_reason: "completed",
      errors: [],
      session_id: thread.thread.id,
      uuid: deliveryId,
    });
    await waitFor(() => notifications.some((event) => event.method === "turn/completed"));

    expect(notifications.find((event) => event.method === "openbot/usage")?.params).toMatchObject({
      turnId: deliveryId,
      modelUsage: {
        "claude-sonnet-5": {
          inputTokens: 100,
          outputTokens: 50,
          cacheReadInputTokens: 200,
          cacheCreationInputTokens: 20,
          costUSD: 0.001,
        },
      },
    });
    expect(notifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: "turn/started" }),
        // Answer text is held rather than streamed, and the thinking that follows it proves it was
        // narration: it is published as commentary instead of a chat bubble.
        expect.objectContaining({
          method: "item/completed",
          params: expect.objectContaining({
            turnId: deliveryId,
            item: {
              id: `${deliveryId}:narration:0`,
              type: "agentMessage",
              phase: "commentary",
              text: "Hi",
            },
          }),
        }),
        expect.objectContaining({
          method: "item/started",
          params: expect.objectContaining({
            turnId: deliveryId,
            item: { id: "tool-use-1", type: "toolCall", name: "WebSearch", status: "in_progress" },
          }),
        }),
        expect.objectContaining({
          method: "item/completed",
          params: expect.objectContaining({
            turnId: deliveryId,
            item: { id: "tool-use-1", type: "toolCall", name: "WebSearch", status: "completed" },
          }),
        }),
        // Extended thinking rides its own item: the `commentary` phase is what routes it to the
        // thinking disclosure instead of the answer bubble.
        expect.objectContaining({
          method: "item/started",
          params: expect.objectContaining({
            turnId: deliveryId,
            item: { id: `${deliveryId}:reasoning`, type: "agentMessage", phase: "commentary" },
          }),
        }),
        expect.objectContaining({
          method: "item/agentMessage/delta",
          params: expect.objectContaining({ itemId: `${deliveryId}:reasoning`, delta: "Weighing it" }),
        }),
        expect.objectContaining({
          method: "item/completed",
          params: expect.objectContaining({
            turnId: deliveryId,
            item: {
              id: `${deliveryId}:reasoning`,
              type: "agentMessage",
              phase: "commentary",
              text: "Weighing it",
            },
          }),
        }),
        expect.objectContaining({
          method: "turn/completed",
          params: expect.objectContaining({ turn: { id: deliveryId, status: "completed" } }),
        }),
      ]),
    );
    await client.stop();
  });

  it("separates streamed reasoning phases the same way as restored history", async () => {
    const { client, notifications, output, threadId } = await createHarness();
    const turnId = "99999999-9999-4999-8999-999999999999";
    await startTurn(client, threadId, turnId);

    output.push(thinkingStreamDelta(threadId, "phase-1", "Check the inputs."));
    output.push(thinkingMessage(threadId, "phase-1", "Check the inputs."));
    output.push(thinkingStreamDelta(threadId, "phase-2", "Compare the options."));
    output.push(thinkingMessage(threadId, "phase-2", "Compare the options."));
    output.push(resultMessage(threadId, turnId, ""));
    await waitFor(() => notifications.some((event) => event.method === "turn/completed"));

    const reasoningItemId = `${turnId}:reasoning`;
    const streamed = notifications
      .filter((event) => event.method === "item/agentMessage/delta")
      .filter((event) => getString(event.params, "itemId") === reasoningItemId)
      .map((event) => getString(event.params, "delta") ?? "")
      .join("");
    const completed = notifications.find(
      (event) =>
        event.method === "item/completed" && getString(getRecord(event.params, "item"), "id") === reasoningItemId,
    );
    expect(streamed).toBe("Check the inputs.\nCompare the options.");
    expect(getString(getRecord(completed?.params, "item"), "text")).toBe(streamed);
    await client.stop();
  });

  it("discovers each model's supported reasoning efforts from the Claude SDK", async () => {
    const query = new TestQuery(new TestQueue<TestStreamMessage>(), [
      {
        value: "opus",
        resolvedModel: "claude-opus-5",
        displayName: "Claude Opus 5",
        description: "Most capable",
        supportsEffort: true,
        supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
      },
      {
        value: "claude-opus-5",
        displayName: "Claude Opus 5 duplicate",
        description: "Duplicate alias",
        supportsEffort: true,
        supportedEffortLevels: ["high"],
      },
      {
        value: "sonnet",
        resolvedModel: "claude-sonnet-5",
        displayName: "Claude Sonnet 5",
        description: "Balanced",
        supportsEffort: true,
        supportedEffortLevels: ["low", "medium", "max"],
      },
      {
        value: "haiku",
        resolvedModel: "claude-haiku-5",
        displayName: "Claude Haiku 5",
        description: "Fast",
        supportsEffort: false,
      },
    ]);
    const client = new ClaudeAgentClient({ executable: "/bin/true", version: "2.1.251" }, () => query);
    client.start();

    await expect(client.request("model/list", {}, decodeModelListResponse)).resolves.toEqual({
      data: [
        {
          model: "claude-opus-5",
          displayName: "Claude Opus 5",
          defaultReasoningEffort: "high",
          supportedReasoningEfforts: [
            { reasoningEffort: "low" },
            { reasoningEffort: "medium" },
            { reasoningEffort: "high" },
            { reasoningEffort: "xhigh" },
            { reasoningEffort: "max" },
          ],
        },
        {
          model: "claude-sonnet-5",
          displayName: "Claude Sonnet 5",
          defaultReasoningEffort: "low",
          supportedReasoningEfforts: [
            { reasoningEffort: "low" },
            { reasoningEffort: "medium" },
            { reasoningEffort: "max" },
          ],
        },
        {
          model: "claude-haiku-5",
          displayName: "Claude Haiku 5",
          defaultReasoningEffort: "medium",
          supportedReasoningEfforts: [{ reasoningEffort: "medium" }],
        },
      ],
    });
    expect(query.closed).toBe(true);
  });

  it("preserves discovered model capabilities when a later refresh times out", async () => {
    const discoveryQuery = new TestQuery(new TestQueue<TestStreamMessage>(), [
      {
        value: "fable",
        resolvedModel: "claude-fable-5",
        displayName: "Claude Fable 5",
        description: "Fast",
        supportsEffort: false,
      },
    ]);
    const timeoutQuery = new TestQuery(new TestQueue<TestStreamMessage>(), new Promise<ModelInfo[]>(() => {}));
    const runtimeQuery = new TestQuery(new TestQueue<TestStreamMessage>());
    const queries = [discoveryQuery, timeoutQuery, runtimeQuery];
    let runtimeOptions: DynamicRecord | null = null;
    const client = new ClaudeAgentClient({ executable: "/bin/true", version: "2.1.251" }, (params) => {
      const next = queries.shift();
      if (!next) throw new Error("Unexpected Claude query.");
      if (next === runtimeQuery && isDynamicRecord(params.options)) runtimeOptions = params.options;
      return next;
    });
    client.start();

    await client.request("model/list", {}, decodeModelListResponse);
    await expect(client.request("model/list", {}, decodeModelListResponse, 10)).rejects.toThrow(
      "Claude request timed out: model/list",
    );
    await client.request(
      "thread/start",
      { cwd: process.cwd(), model: "claude-fable-5", effort: "medium" },
      decodeThreadResponse,
    );

    expect(runtimeOptions).toMatchObject({ model: "fable" });
    expect(runtimeOptions).not.toHaveProperty("effort");
    expect(timeoutQuery.closed).toBe(true);
    await client.stop();
  });

  it("uses alias-only discovery values for Claude SDK model selection", async () => {
    root = await mkdtemp(join(tmpdir(), "openbot-claude-model-alias-"));
    const discoveryQuery = new TestQuery(new TestQueue<TestStreamMessage>(), [
      {
        value: "sonnet",
        displayName: "Claude Sonnet",
        description: "Balanced",
        supportsEffort: true,
        supportedEffortLevels: ["medium", "high"],
      },
    ]);
    const initialQuery = new TestQuery(new TestQueue<TestStreamMessage>());
    const switchingQuery = new TestQuery(new TestQueue<TestStreamMessage>());
    const queries = [discoveryQuery, initialQuery, switchingQuery];
    let initialOptions: DynamicRecord | null = null;
    const client = new ClaudeAgentClient({ executable: "/bin/true", version: "2.1.251" }, (params) => {
      const next = queries.shift();
      if (!next) throw new Error("Unexpected Claude query.");
      if (next === initialQuery && isDynamicRecord(params.options)) initialOptions = params.options;
      return next;
    });
    client.start();

    await expect(client.request("model/list", {}, decodeModelListResponse)).resolves.toEqual({
      data: [expect.objectContaining({ model: "sonnet" })],
    });
    await client.request("thread/start", { cwd: root, model: "sonnet", effort: "medium" }, decodeThreadResponse);
    expect(initialOptions).toMatchObject({ model: "sonnet" });

    const switchingThread = await client.request(
      "thread/start",
      { cwd: root, model: "claude-opus-5", effort: "medium" },
      decodeThreadResponse,
    );
    await client.request(
      "turn/start",
      { threadId: switchingThread.thread.id, model: "sonnet", effort: "medium", input: [] },
      decodeTurnResponse,
    );
    expect(switchingQuery.models).toEqual(["sonnet"]);

    await client.stop();
  });

  it("keeps neutral UI effort for unsupported models without sending effort to Claude", async () => {
    root = await mkdtemp(join(tmpdir(), "openbot-claude-effort-support-"));
    const discoveryQuery = new TestQuery(new TestQueue<TestStreamMessage>(), [
      {
        value: "haiku",
        resolvedModel: "claude-haiku-5",
        displayName: "Claude Haiku 5",
        description: "Fast",
        supportsEffort: false,
      },
      {
        value: "sonnet",
        resolvedModel: "claude-sonnet-5",
        displayName: "Claude Sonnet 5",
        description: "Balanced",
        supportsEffort: true,
        supportedEffortLevels: ["low", "medium", "max"],
      },
    ]);
    const unsupportedQuery = new TestQuery(new TestQueue<TestStreamMessage>());
    const switchingQuery = new TestQuery(new TestQueue<TestStreamMessage>());
    const effortChangingQuery = new TestQuery(new TestQueue<TestStreamMessage>());
    const clearingQuery = new TestQuery(new TestQueue<TestStreamMessage>());
    const queries = [discoveryQuery, unsupportedQuery, switchingQuery, effortChangingQuery, clearingQuery];
    const runtimeOptions: DynamicRecord[] = [];
    const client = new ClaudeAgentClient({ executable: "/bin/true", version: "2.1.251" }, (params) => {
      const next = queries.shift();
      if (!next) throw new Error("Unexpected Claude query.");
      if (next !== discoveryQuery && isDynamicRecord(params.options)) runtimeOptions.push(params.options);
      return next;
    });
    client.start();

    const models = await client.request("model/list", {}, decodeModelListResponse);
    expect(models.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          model: "claude-haiku-5",
          defaultReasoningEffort: "medium",
          supportedReasoningEfforts: [{ reasoningEffort: "medium" }],
        }),
      ]),
    );

    const unsupportedThread = await client.request(
      "thread/start",
      { cwd: root, model: "claude-haiku-5", effort: "medium" },
      decodeThreadResponse,
    );
    expect(runtimeOptions[0]).not.toHaveProperty("effort");
    await client.request(
      "turn/start",
      { threadId: unsupportedThread.thread.id, model: "claude-haiku-5", effort: "high", input: [] },
      decodeTurnResponse,
    );
    expect(unsupportedQuery.flagSettings).toEqual([]);

    const switchingThread = await client.request(
      "thread/start",
      { cwd: root, model: "claude-haiku-5", effort: "medium" },
      decodeThreadResponse,
    );
    await client.request(
      "turn/start",
      { threadId: switchingThread.thread.id, model: "claude-sonnet-5", effort: "high", input: [] },
      decodeTurnResponse,
    );
    expect(switchingQuery.models).toEqual(["sonnet"]);
    expect(switchingQuery.flagSettings).toEqual([{ effortLevel: "low" }]);

    const effortChangingThread = await client.request(
      "thread/start",
      { cwd: root, model: "claude-sonnet-5", effort: "high" },
      decodeThreadResponse,
    );
    expect(runtimeOptions[2]).toMatchObject({ effort: "low" });
    await client.request(
      "turn/start",
      { threadId: effortChangingThread.thread.id, model: "claude-sonnet-5", effort: "max", input: [] },
      decodeTurnResponse,
    );
    expect(effortChangingQuery.models).toEqual([]);
    expect(effortChangingQuery.flagSettings).toEqual([{ effortLevel: "max" }]);

    const clearingThread = await client.request(
      "thread/start",
      { cwd: root, model: "claude-sonnet-5", effort: "medium" },
      decodeThreadResponse,
    );
    await client.request(
      "turn/start",
      { threadId: clearingThread.thread.id, model: "claude-haiku-5", effort: "medium", input: [] },
      decodeTurnResponse,
    );
    expect(clearingQuery.models).toEqual(["haiku"]);
    expect(clearingQuery.flagSettings).toEqual([{ effortLevel: null }]);

    await client.stop();
  });

  it("restarts an inactive session when resumed with updated memory instructions", async () => {
    root = await mkdtemp(join(tmpdir(), "openbot-claude-memory-resume-"));
    const instructions: string[] = [];
    const snapshots: unknown[] = [];
    const client = new ClaudeAgentClient({ executable: "/bin/true", version: "2.1.280" }, (params) => {
      const options: DynamicRecord | null = isDynamicRecord(params.options) ? params.options : null;
      const systemPrompt = options?.systemPrompt;
      if (isDynamicRecord(systemPrompt) && isString(systemPrompt.append)) instructions.push(systemPrompt.append);
      snapshots.push(options?.extraArgs);
      return new TestQuery(new TestQueue<TestStreamMessage>());
    });
    client.start();
    const config = {
      cwd: root,
      model: "claude-sonnet-5",
      developerInstructions: "<agent_memories>[]</agent_memories>",
      runtimeWorkspaceRoots: [root],
    };
    const thread = await client.request("thread/start", config, decodeThreadResponse);
    await client.request(
      "thread/resume",
      {
        ...config,
        threadId: thread.thread.id,
        developerInstructions: '<agent_memories>[{"text":"Uses metric units."}]</agent_memories>',
      },
      decodeThreadResponse,
    );

    expect(instructions).toEqual([
      "<agent_memories>[]</agent_memories>",
      '<agent_memories>[{"text":"Uses metric units."}]</agent_memories>',
    ]);
    // A CLI that records the first prompt would send it again on resume and drop the new text.
    const off = { "system-prompt-snapshot": "off" };
    expect(snapshots).toEqual([off, off]);
    await client.stop();
  });

  it("closes an idle thread's process and resumes the same session on the next turn", async () => {
    root = await mkdtemp(join(tmpdir(), "openbot-claude-idle-release-"));
    const spawned: Array<{ query: TestQuery; options: DynamicRecord | null }> = [];
    const client = new ClaudeAgentClient({ executable: "/bin/true", version: "2.1.231" }, (params) => {
      const query = new TestQuery(new TestQueue<TestStreamMessage>());
      spawned.push({ query, options: isDynamicRecord(params.options) ? params.options : null });
      return query;
    });
    client.start();
    vi.useFakeTimers();
    try {
      const thread = await client.request(
        "thread/start",
        { cwd: root, model: "claude-sonnet-5", developerInstructions: "Be concise.", runtimeWorkspaceRoots: [root] },
        decodeThreadResponse,
      );
      const threadId = thread.thread.id;

      await vi.advanceTimersByTimeAsync(CLAUDE_THREAD_IDLE_RELEASE_MS);
      expect(spawned[0]?.query.closed).toBe(true);

      await startTurn(client, threadId, "66666666-6666-4666-8666-666666666666");
      expect(spawned).toHaveLength(2);
      expect(spawned[1]?.options).toMatchObject({ resume: threadId, cwd: root, model: "claude-sonnet-5" });
      // A thread in a turn is never idle.
      await vi.advanceTimersByTimeAsync(CLAUDE_THREAD_IDLE_RELEASE_MS);
      expect(spawned[1]?.query.closed).toBe(false);
    } finally {
      vi.useRealTimers();
    }
    await client.stop();
  });

  it("keeps only the most recently idle thread processes and resumes a released one", async () => {
    root = await mkdtemp(join(tmpdir(), "openbot-claude-idle-limit-"));
    const spawned: Array<{ query: TestQuery; output: TestQueue<TestStreamMessage>; options: DynamicRecord | null }> =
      [];
    const client = new ClaudeAgentClient({ executable: "/bin/true", version: "2.1.231" }, (params) => {
      const output = new TestQueue<TestStreamMessage>();
      const query = new TestQuery(output);
      spawned.push({ query, output, options: isDynamicRecord(params.options) ? params.options : null });
      return query;
    });
    const notifications: Array<{ method: string; params: unknown }> = [];
    client.on("notification", (notification) => notifications.push(notification));
    client.start();
    const threadIds: string[] = [];
    for (let index = 0; index <= CLAUDE_IDLE_THREAD_LIMIT; index += 1) {
      const thread = await client.request(
        "thread/start",
        { cwd: root, model: "claude-sonnet-5", runtimeWorkspaceRoots: [root] },
        decodeThreadResponse,
      );
      threadIds.push(thread.thread.id);
    }
    // Agents that start together open every thread before any turn starts, and none of them is idle.
    expect(spawned.map((one) => one.query.closed)).toEqual(Array(CLAUDE_IDLE_THREAD_LIMIT + 1).fill(false));

    for (const [index, threadId] of threadIds.entries()) {
      const turnId = `00000000-0000-4000-8000-00000000000${index}`;
      await startTurn(client, threadId, turnId);
      spawned[index]?.output.push(resultMessage(threadId, turnId, ""));
      await waitFor(() => notifications.filter((event) => event.method === "turn/completed").length === index + 1);
    }
    expect(spawned.map((one) => one.query.closed)).toEqual([true, ...Array(CLAUDE_IDLE_THREAD_LIMIT).fill(false)]);

    await startTurn(client, threadIds[0] ?? "", "77777777-7777-4777-8777-777777777777");
    expect(spawned.at(-1)?.options).toMatchObject({ resume: threadIds[0] });
    // The thread in a turn is not idle, so the others keep their processes.
    expect(spawned.slice(1, -1).map((one) => one.query.closed)).toEqual(Array(CLAUDE_IDLE_THREAD_LIMIT).fill(false));
    await client.stop();
  });

  it("uses a complete assistant message when Claude omits stream deltas", async () => {
    const { client, notifications, output, threadId } = await createHarness();
    const turnId = "11111111-1111-4111-8111-111111111111";
    await startTurn(client, threadId, turnId);

    output.push(assistantMessage(threadId, "child-message", "Hidden child response", "tool-use-1"));
    output.push(assistantMessage(threadId, "main-message", "Visible without a refresh"));
    output.push(resultMessage(threadId, turnId, ""));
    await waitFor(() => notifications.some((event) => event.method === "turn/completed"));

    expect(answerText(notifications)).toBe("Visible without a refresh");
    expect(narrationTexts(notifications)).toEqual([]);
    expect(JSON.stringify(notifications)).not.toContain("Hidden child response");
    await client.stop();
  });

  it("steers a second user message into the active Claude runtime", async () => {
    const { client, prompt, threadId } = await createHarness();
    const turnId = "44444444-4444-4444-8444-444444444444";
    await startTurn(client, threadId, turnId);
    const iterator = prompt[Symbol.asyncIterator]();
    const first = await iterator.next();
    expect(first.value).toMatchObject({ uuid: turnId, message: { content: "Hello" } });

    await expect(
      client.request(
        "turn/steer",
        {
          threadId,
          expectedTurnId: turnId,
          clientUserMessageId: "55555555-5555-4555-8555-555555555555",
          input: [{ type: "text", text: "Also check the queue." }],
        },
        decodeRecordResponse,
      ),
    ).resolves.toEqual({ turnId });
    const steered = await iterator.next();
    expect(steered.value).toMatchObject({
      uuid: "55555555-5555-4555-8555-555555555555",
      message: { content: "Also check the queue." },
    });
    await client.stop();
  });

  it("adds only the missing suffix from a complete assistant message", async () => {
    const { client, notifications, output, threadId } = await createHarness();
    const turnId = "22222222-2222-4222-8222-222222222222";
    await startTurn(client, threadId, turnId);

    output.push(streamDelta(threadId, turnId, "Hel"));
    output.push(assistantMessage(threadId, "main-message", "Hello"));
    output.push(resultMessage(threadId, turnId, "Hello"));
    await waitFor(() => notifications.some((event) => event.method === "turn/completed"));

    // The suffix is added to the held buffer, so the answer reads once rather than as "HelHello".
    expect(answerText(notifications)).toBe("Hello");
    expect(narrationTexts(notifications)).toEqual([]);
    await client.stop();
  });

  it.each([["Only one answer."], ["Before I prepare the plan, choose a setup.", "Here is the detailed setup plan."]])(
    "keeps live Claude answers through history backfill: %j",
    async (...parts: string[]) => {
      const history: SessionMessage[] = [];
      const { client, notifications, output, threadId } = await createHarness(history);
      const turnId = "33333333-3333-4333-8333-333333333388";
      history.push({
        type: "user",
        uuid: turnId,
        session_id: threadId,
        parent_tool_use_id: null,
        parent_agent_id: null,
        message: { content: "Prepare the setup." },
      });
      await startTurn(client, threadId, turnId);
      parts.forEach((text, index) => {
        output.push(streamDelta(threadId, turnId, text));
        output.push(assistantMessage(threadId, `claude-answer-${index}`, text));
        history.push({
          type: "assistant",
          uuid: `claude-answer-${index}`,
          session_id: threadId,
          parent_tool_use_id: null,
          parent_agent_id: null,
          message: { content: [{ type: "text", text }] },
        });
        if (index === 0 && parts.length > 1) {
          output.push(toolUseMessage(threadId, "question-call", "question-tool", "AskUserQuestion"));
          output.push(toolResultMessage(threadId, "question-result", "question-tool"));
          history.push({
            type: "assistant",
            uuid: "question-call",
            session_id: threadId,
            parent_tool_use_id: null,
            parent_agent_id: null,
            message: { content: [{ type: "tool_use", id: "question-tool", name: "AskUserQuestion" }] },
          });
          history.push({
            type: "user",
            uuid: "question-result",
            session_id: threadId,
            parent_tool_use_id: null,
            parent_agent_id: null,
            message: {
              content: [{ type: "tool_result", tool_use_id: "question-tool", content: "Infrastructure only" }],
            },
          });
        }
      });
      output.push(resultMessage(threadId, turnId, parts.join("")));
      await waitFor(() => notifications.some((event) => event.method === "turn/completed"));
      // Only the last part ends the turn. Everything before it was narration between tool calls,
      // and rides the thinking disclosure rather than a chat bubble.
      const narration = parts.slice(0, -1);
      const finalText = parts.at(-1) ?? "";
      expect(answerText(notifications)).toBe(finalText);
      expect(narrationTexts(notifications)).toEqual(narration);
      const itemId = getString(answerItem(notifications), "id");
      if (!itemId || !root) throw new Error("Missing completed message or test database directory.");
      const store = new AgentStore(join(root, "data"), join(root, "home"));
      const database = store.database;
      try {
        await store.initialize();
        const agent = await store.createAgent({
          name: "History test",
          description: "Synthetic duplication diagnosis",
          avatarSeed: "setup:planning",
          avatarHue: 215,
        });
        const publicThreadId = store.ensureThreadIdNow(agent.id);
        const live = {
          agentId: agent.id,
          threadId: publicThreadId,
          activeTurnId: null,
          revision: 0,
          messages: [
            ...narration.map((text, index) => ({
              ...newAssistantMessage(`${turnId}:narration:${index}`, turnId),
              text,
              itemType: "commentary",
              status: "completed" as const,
            })),
            { ...newAssistantMessage(itemId, turnId), text: finalText, status: "completed" as const },
          ],
        };
        database.persistConversation(live, "test.live-completed");
        const restored = await client.request("thread/read", { threadId }, decodeThreadResponse);
        const imported = snapshotFromThread(agent.id, restored.thread, () => null);
        imported.threadId = publicThreadId;
        const merged = mergeProviderHistory(database.readConversation(agent.id, publicThreadId), imported, "claude");
        database.persistConversation(merged, "provider-history.backfilled");
        const assistant = database
          .readConversation(agent.id, publicThreadId)
          .messages.filter((message) => message.author === "assistant");
        const answers = assistant.filter((message) => message.itemType !== "commentary");
        expect(answers.map((message) => message.text)).toEqual([finalText]);
        expect(answers.map((message) => message.id)).toEqual([itemId]);
        // The backfill keeps the narration this app recorded and adds no second copy of it.
        const thinking = assistant.filter((message) => message.itemType === "commentary");
        expect(thinking.map((message) => message.text)).toEqual(narration);
      } finally {
        database.close();
        await client.stop();
      }
    },
  );

  it("answers with streamed text that no complete assistant message repeats", async () => {
    const { client, notifications, output, threadId } = await createHarness();
    const turnId = "88888888-8888-4888-8888-888888888888";
    await startTurn(client, threadId, turnId);

    output.push(streamDelta(threadId, turnId, "Streamed only."));
    output.push(resultMessage(threadId, turnId, ""));
    await waitFor(() => notifications.some((event) => event.method === "turn/completed"));

    expect(answerText(notifications)).toBe("Streamed only.");
    expect(narrationTexts(notifications)).toEqual([]);
    await client.stop();
  });

  it("keeps the answer when a message fills in the rest of a thinking block", async () => {
    const { client, notifications, output, threadId } = await createHarness();
    const turnId = "14141414-1414-4141-8141-141414141414";
    await startTurn(client, threadId, turnId);

    output.push(thinkingStreamDelta(threadId, "phase-1", "Think"));
    output.push(streamDelta(threadId, turnId, "Done."));
    // The message supplies the rest of the thinking that already started. No step closes here.
    output.push(thinkingMessage(threadId, "phase-1", "Thinking."));
    output.push(assistantMessage(threadId, "answer-message", "Done."));
    output.push(resultMessage(threadId, turnId, "Done."));
    await waitFor(() => notifications.some((event) => event.method === "turn/completed"));

    expect(narrationTexts(notifications)).toEqual([]);
    expect(answerText(notifications)).toBe("Done.");
    await client.stop();
  });

  it("closes a step at a thinking block a message carries with no deltas of its own", async () => {
    const { client, notifications, output, threadId } = await createHarness();
    const turnId = "16161616-1616-4161-8161-161616161616";
    await startTurn(client, threadId, turnId);

    // No deltas at all, so block order is the only thing that says what came before the thinking.
    output.push({
      type: "assistant",
      parent_tool_use_id: null,
      session_id: threadId,
      uuid: "whole-message",
      message: {
        content: [
          { type: "text", text: "Let me weigh it." },
          { type: "thinking", thinking: "Weighing it." },
          { type: "text", text: "Done." },
        ],
      },
    });
    output.push(resultMessage(threadId, turnId, "Let me weigh it.\nDone."));
    await waitFor(() => notifications.some((event) => event.method === "turn/completed"));

    // The break between the two blocks goes with the part that ends, so the answer reads clean.
    expect(narrationTexts(notifications)).toEqual(["Let me weigh it.\n"]);
    expect(answerText(notifications)).toBe("Done.");
    await client.stop();
  });

  it("closes the step once when a message repeats a thinking block its deltas announced", async () => {
    const { client, notifications, output, threadId } = await createHarness();
    const turnId = "17171717-1717-4171-8171-171717171717";
    await startTurn(client, threadId, turnId);

    output.push(streamDelta(threadId, turnId, "Let me weigh it."));
    output.push(thinkingStreamDelta(threadId, "whole-message", "Weighing it."));
    output.push(streamDelta(threadId, turnId, "Done."));
    // The message carries the block the deltas already announced, so it closes no second step.
    output.push({
      type: "assistant",
      parent_tool_use_id: null,
      session_id: threadId,
      uuid: "whole-message",
      message: {
        content: [
          { type: "text", text: "Let me weigh it." },
          { type: "thinking", thinking: "Weighing it." },
          { type: "text", text: "Done." },
        ],
      },
    });
    output.push(resultMessage(threadId, turnId, "Let me weigh it.\nDone."));
    await waitFor(() => notifications.some((event) => event.method === "turn/completed"));

    expect(narrationTexts(notifications)).toEqual(["Let me weigh it."]);
    await client.stop();
  });

  it("closes a step for each thinking block a turn begins", async () => {
    const { client, notifications, output, threadId } = await createHarness();
    const turnId = "15151515-1515-4151-8151-151515151515";
    await startTurn(client, threadId, turnId);

    output.push(streamDelta(threadId, turnId, "Plan."));
    output.push(thinkingStreamDelta(threadId, "phase-1", "First"));
    output.push(streamDelta(threadId, turnId, "Then this."));
    output.push(thinkingStreamDelta(threadId, "phase-2", "Second"));
    output.push(streamDelta(threadId, turnId, "Done."));
    output.push(assistantMessage(threadId, "answer-message", "Plan.Then this.Done."));
    output.push(resultMessage(threadId, turnId, "Plan.Then this.Done."));
    await waitFor(() => notifications.some((event) => event.method === "turn/completed"));

    expect(narrationTexts(notifications)).toEqual(["Plan.", "Then this."]);
    expect(answerText(notifications)).toBe("Done.");
    await client.stop();
  });

  it("corrects narration a thinking boundary already published", async () => {
    const { client, notifications, output, threadId } = await createHarness();
    const turnId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    await startTurn(client, threadId, turnId);

    // Thinking closes the step while the message carrying the text is still arriving.
    output.push(streamDelta(threadId, turnId, "Pln."));
    output.push(thinkingStreamDelta(threadId, "phase-1", "Weighing it."));
    output.push(assistantMessage(threadId, "narration-message", "Plan."));
    output.push(assistantMessage(threadId, "answer-message", "Done."));
    output.push(resultMessage(threadId, turnId, "Plan.Done."));
    await waitFor(() => notifications.some((event) => event.method === "turn/completed"));

    expect(narrationTexts(notifications).at(-1)).toBe("Plan.");
    expect(answerText(notifications)).toBe("Done.");
    await client.stop();
  });

  it("corrects published narration without taking the answer into it", async () => {
    const { client, notifications, output, threadId } = await createHarness();
    const turnId = "12121212-1212-4121-8121-121212121212";
    await startTurn(client, threadId, turnId);

    // The answer streams before the message that puts the published narration right.
    output.push(streamDelta(threadId, turnId, "Pln."));
    output.push(thinkingStreamDelta(threadId, "phase-1", "Weighing it."));
    output.push(streamDelta(threadId, turnId, "Done."));
    output.push(assistantMessage(threadId, "whole-message", "Plan.Done."));
    output.push(resultMessage(threadId, turnId, "Plan.Done."));
    await waitFor(() => notifications.some((event) => event.method === "turn/completed"));

    expect(narrationTexts(notifications).at(-1)).toBe("Plan.");
    expect(answerText(notifications)).toBe("Done.");
    await client.stop();
  });

  it("does not repeat the answer when the correction arrives in its own message", async () => {
    const { client, notifications, output, threadId } = await createHarness();
    const turnId = "13131313-1313-4131-8131-131313131313";
    await startTurn(client, threadId, turnId);

    output.push(streamDelta(threadId, turnId, "Pln."));
    output.push(thinkingStreamDelta(threadId, "phase-1", "Weighing it."));
    output.push(streamDelta(threadId, turnId, "Done."));
    // The narration and the answer are confirmed one message at a time, correction first.
    output.push(assistantMessage(threadId, "narration-message", "Plan."));
    output.push(assistantMessage(threadId, "answer-message", "Done."));
    output.push(resultMessage(threadId, turnId, "Plan.Done."));
    await waitFor(() => notifications.some((event) => event.method === "turn/completed"));

    expect(narrationTexts(notifications).at(-1)).toBe("Plan.");
    expect(answerText(notifications)).toBe("Done.");
    await client.stop();
  });

  it("restores text a message placed before its thinking as commentary", async () => {
    const turnId = "18181818-1818-4181-8181-181818181818";
    const history: SessionMessage[] = [];
    const { client, threadId } = await createHarness(history);
    history.push(
      {
        type: "user",
        uuid: turnId,
        session_id: threadId,
        parent_tool_use_id: null,
        parent_agent_id: null,
        message: { content: "Weigh it." },
      },
      {
        type: "assistant",
        uuid: "whole-message",
        session_id: threadId,
        parent_tool_use_id: null,
        parent_agent_id: null,
        message: {
          content: [
            { type: "text", text: "Let me weigh it." },
            { type: "thinking", thinking: "Weighing it." },
            { type: "text", text: "Done." },
          ],
        },
      },
    );

    const restored = await client.request("thread/read", { threadId }, decodeThreadResponse);
    const items = (restored.thread.turns ?? []).flatMap((turn) => turn.items ?? []);
    expect(items.filter((item) => item.type === "agentMessage" && !item.phase).map((item) => item.text)).toEqual([
      "Done.",
    ]);
    expect(items.filter((item) => item.phase === "commentary").map((item) => item.text)).toEqual([
      "Let me weigh it.\n",
      "Weighing it.",
    ]);
    await client.stop();
  });

  it("restores a turn whose last text gave way to thinking as commentary", async () => {
    const turnId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const history: SessionMessage[] = [];
    const { client, threadId } = await createHarness(history);
    history.push(
      {
        type: "user",
        uuid: turnId,
        session_id: threadId,
        parent_tool_use_id: null,
        parent_agent_id: null,
        message: { content: "Plan the work." },
      },
      {
        type: "assistant",
        uuid: "restored-narration",
        session_id: threadId,
        parent_tool_use_id: null,
        parent_agent_id: null,
        message: { content: [{ type: "text", text: "Plan." }] },
      },
      // The turn stopped while thinking, so no later text proves the narration was not the answer.
      {
        type: "assistant",
        uuid: "restored-thinking",
        session_id: threadId,
        parent_tool_use_id: null,
        parent_agent_id: null,
        message: { content: [{ type: "thinking", thinking: "Weighing it." }] },
      },
    );

    const restored = await client.request("thread/read", { threadId }, decodeThreadResponse);
    const items = (restored.thread.turns ?? []).flatMap((turn) => turn.items ?? []);
    expect(items.filter((item) => item.id === "restored-narration").map((item) => [item.id, item.phase])).toEqual([
      ["restored-narration", "commentary"],
    ]);
    await client.stop();
  });

  it("corrects narration before publishing it, so the answer still lands", async () => {
    const { client, notifications, output, threadId } = await createHarness();
    const turnId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    await startTurn(client, threadId, turnId);

    // The narration stream dropped a letter, and the answer arrives only as a complete message.
    output.push(streamDelta(threadId, turnId, "Pln."));
    output.push(assistantMessage(threadId, "narration-message", "Plan."));
    output.push(toolUseMessage(threadId, "tool-message", "tool-use-1", "Read"));
    output.push(toolResultMessage(threadId, "tool-result", "tool-use-1"));
    output.push(assistantMessage(threadId, "answer-message", "Done."));
    output.push(resultMessage(threadId, turnId, "Plan.Done."));
    await waitFor(() => notifications.some((event) => event.method === "turn/completed"));

    expect(narrationTexts(notifications)).toEqual(["Plan."]);
    expect(answerText(notifications)).toBe("Done.");
    await client.stop();
  });

  it("corrects an answer the stream truncated after narration was published", async () => {
    const { client, notifications, output, threadId } = await createHarness();
    const turnId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    await startTurn(client, threadId, turnId);

    output.push(streamDelta(threadId, turnId, "Plan."));
    output.push(assistantMessage(threadId, "narration-message", "Plan."));
    output.push(toolUseMessage(threadId, "tool-message", "tool-use-1", "Read"));
    output.push(toolResultMessage(threadId, "tool-result", "tool-use-1"));
    // The stream dropped a letter; the complete message is what Claude actually said.
    output.push(streamDelta(threadId, turnId, "Helo"));
    output.push(assistantMessage(threadId, "answer-message", "Hello"));
    output.push(resultMessage(threadId, turnId, "Plan.Hello"));
    await waitFor(() => notifications.some((event) => event.method === "turn/completed"));

    expect(narrationTexts(notifications)).toEqual(["Plan."]);
    expect(answerText(notifications)).toBe("Hello");
    await client.stop();
  });

  it("keeps narration out of the answer when Claude omits stream deltas", async () => {
    const { client, notifications, output, threadId } = await createHarness();
    const turnId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await startTurn(client, threadId, turnId);

    // One message carries the narration and the call it introduces, and no delta announced it.
    output.push(narratedToolUseMessage(threadId, "narrating-call", "tool-use-1", "Read", "Let me read the file."));
    output.push(toolResultMessage(threadId, "tool-result", "tool-use-1"));
    output.push(assistantMessage(threadId, "answer-message", "The file sets the timeout."));
    output.push(resultMessage(threadId, turnId, "Let me read the file.The file sets the timeout."));
    await waitFor(() => notifications.some((event) => event.method === "turn/completed"));

    expect(narrationTexts(notifications)).toEqual(["Let me read the file."]);
    expect(answerText(notifications)).toBe("The file sets the timeout.");
    await client.stop();
  });

  it("restores a turn whose last text introduced a tool call as commentary", async () => {
    const turnId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const history: SessionMessage[] = [];
    const { client, threadId } = await createHarness(history);
    history.push(
      {
        type: "user",
        uuid: turnId,
        session_id: threadId,
        parent_tool_use_id: null,
        parent_agent_id: null,
        message: { content: "Fix the timeout." },
      },
      {
        type: "assistant",
        uuid: "restored-narration",
        session_id: threadId,
        parent_tool_use_id: null,
        parent_agent_id: null,
        message: { content: [{ type: "text", text: "Let me fix it." }] },
      },
      // The turn stopped on the tool call, so no later text proves the narration was not the answer.
      {
        type: "assistant",
        uuid: "restored-call",
        session_id: threadId,
        parent_tool_use_id: null,
        parent_agent_id: null,
        message: { content: [{ type: "tool_use", id: "tool-use-1", name: "Edit" }] },
      },
    );

    const restored = await client.request("thread/read", { threadId }, decodeThreadResponse);
    const items = (restored.thread.turns ?? []).flatMap((turn) => turn.items ?? []);
    expect(items.filter((item) => item.type === "agentMessage").map((item) => [item.id, item.phase])).toEqual([
      ["restored-narration", "commentary"],
    ]);
    await client.stop();
  });

  it("keeps the text before a tool call out of the answer bubble", async () => {
    const { client, notifications, output, threadId } = await createHarness();
    const turnId = "66666666-6666-4666-8666-666666666666";
    await startTurn(client, threadId, turnId);

    output.push(streamDelta(threadId, turnId, "Let me read the file."));
    output.push(assistantMessage(threadId, "narration-message", "Let me read the file."));
    output.push(toolUseMessage(threadId, "tool-message", "tool-use-1", "Read"));
    output.push(toolResultMessage(threadId, "tool-result", "tool-use-1"));
    output.push(streamDelta(threadId, turnId, "The file sets the timeout."));
    output.push(assistantMessage(threadId, "answer-message", "The file sets the timeout."));
    output.push(resultMessage(threadId, turnId, "Let me read the file.The file sets the timeout."));
    await waitFor(() => notifications.some((event) => event.method === "turn/completed"));

    expect(narrationTexts(notifications)).toEqual(["Let me read the file."]);
    expect(answerItem(notifications)).toMatchObject({
      id: `${turnId}:assistant`,
      type: "agentMessage",
      text: "The file sets the timeout.",
    });
    await client.stop();
  });

  it("restores a turn's earlier answers as commentary", async () => {
    const turnId = "77777777-7777-4777-8777-777777777777";
    const history: SessionMessage[] = [];
    const { client, threadId } = await createHarness(history);
    history.push(
      {
        type: "user",
        uuid: turnId,
        session_id: threadId,
        parent_tool_use_id: null,
        parent_agent_id: null,
        message: { content: "Check the timeout." },
      },
      {
        type: "assistant",
        uuid: "restored-narration",
        session_id: threadId,
        parent_tool_use_id: null,
        parent_agent_id: null,
        message: { content: [{ type: "text", text: "Let me read the file." }] },
      },
      {
        type: "assistant",
        uuid: "restored-answer",
        session_id: threadId,
        parent_tool_use_id: null,
        parent_agent_id: null,
        message: { content: [{ type: "text", text: "The file sets the timeout." }] },
      },
    );

    const restored = await client.request("thread/read", { threadId }, decodeThreadResponse);
    const items = (restored.thread.turns ?? []).flatMap((turn) => turn.items ?? []);
    expect(items.filter((item) => item.type === "agentMessage").map((item) => [item.id, item.phase])).toEqual([
      ["restored-narration", "commentary"],
      ["restored-answer", undefined],
    ]);
    await client.stop();
  });

  it("does not duplicate a fully streamed assistant message", async () => {
    const { client, notifications, output, threadId } = await createHarness();
    const turnId = "33333333-3333-4333-8333-333333333333";
    await startTurn(client, threadId, turnId);

    output.push(streamDelta(threadId, turnId, "Hello"));
    output.push(assistantMessage(threadId, "main-message", "Hello"));
    output.push(resultMessage(threadId, turnId, "Hello"));
    await waitFor(() => notifications.some((event) => event.method === "turn/completed"));

    expect(answerText(notifications)).toBe("Hello");
    expect(narrationTexts(notifications)).toEqual([]);
    await client.stop();
  });
});

async function createHarness(history?: SessionMessage[]): Promise<{
  client: ClaudeAgentClient;
  notifications: Array<{ method: string; params: unknown }>;
  output: TestQueue<TestStreamMessage>;
  prompt: AsyncIterable<SDKUserMessage>;
  threadId: string;
}> {
  root = await mkdtemp(join(tmpdir(), "openbot-claude-client-"));
  const output = new TestQueue<TestStreamMessage>();
  let prompt: AsyncIterable<SDKUserMessage> | null = null;
  const generator = new TestQuery(output);
  const client = new ClaudeAgentClient(
    { executable: "/bin/true", version: "2.1.231" },
    (params) => {
      if (!isString(params.prompt)) prompt = params.prompt;
      return generator;
    },
    history ? async () => history : undefined,
  );
  const notifications: Array<{ method: string; params: unknown }> = [];
  client.on("notification", (notification) => notifications.push(notification));
  client.start();
  const thread = await client.request(
    "thread/start",
    {
      cwd: root,
      model: "claude-sonnet-5",
      developerInstructions: "Be concise.",
      runtimeWorkspaceRoots: [root],
    },
    decodeThreadResponse,
  );
  if (!prompt) throw new Error("Claude prompt was not initialized.");
  return { client, notifications, output, prompt, threadId: thread.thread.id };
}

function startTurn(client: ClaudeAgentClient, threadId: string, turnId: string) {
  return client.request(
    "turn/start",
    {
      threadId,
      clientUserMessageId: turnId,
      input: [{ type: "text", text: "Hello" }],
    },
    decodeTurnResponse,
  );
}

function streamDelta(threadId: string, turnId: string, text: string): TestStreamMessage {
  return {
    type: "stream_event",
    parent_tool_use_id: null,
    session_id: threadId,
    uuid: turnId,
    event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
  };
}

function thinkingStreamDelta(threadId: string, messageId: string, thinking: string): TestStreamMessage {
  return {
    type: "stream_event",
    parent_tool_use_id: null,
    session_id: threadId,
    uuid: messageId,
    event: { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking } },
  };
}

function thinkingMessage(threadId: string, messageId: string, thinking: string): TestStreamMessage {
  return {
    type: "assistant",
    parent_tool_use_id: null,
    session_id: threadId,
    uuid: messageId,
    message: { content: [{ type: "thinking", thinking }] },
  };
}

function assistantMessage(
  threadId: string,
  messageId: string,
  text: string,
  parentToolUseId: string | null = null,
): TestStreamMessage {
  return {
    type: "assistant",
    parent_tool_use_id: parentToolUseId,
    session_id: threadId,
    uuid: messageId,
    message: { content: [{ type: "text", text }] },
  };
}

function narratedToolUseMessage(
  threadId: string,
  messageId: string,
  toolUseId: string,
  name: string,
  text: string,
): TestStreamMessage {
  return {
    type: "assistant",
    parent_tool_use_id: null,
    session_id: threadId,
    uuid: messageId,
    message: {
      content: [
        { type: "text", text },
        { type: "tool_use", id: toolUseId, name },
      ],
    },
  };
}

function toolUseMessage(threadId: string, messageId: string, toolUseId: string, name: string): TestStreamMessage {
  return {
    type: "assistant",
    parent_tool_use_id: null,
    session_id: threadId,
    uuid: messageId,
    message: { content: [{ type: "tool_use", id: toolUseId, name }] },
  };
}

function toolResultMessage(threadId: string, messageId: string, toolUseId: string): TestStreamMessage {
  return {
    type: "user",
    parent_tool_use_id: null,
    session_id: threadId,
    uuid: messageId,
    message: { content: [{ type: "tool_result", tool_use_id: toolUseId }] },
  };
}

function resultMessage(threadId: string, turnId: string, result: string): TestStreamMessage {
  return {
    type: "result",
    subtype: "success",
    result,
    terminal_reason: "completed",
    errors: [],
    session_id: threadId,
    uuid: turnId,
  };
}

function answerItem(notifications: Array<{ method: string; params: unknown }>): DynamicRecord | null {
  const completed = notifications.find((event) => {
    const item = getRecord(event.params, "item");
    return event.method === "item/completed" && getString(item, "type") === "agentMessage" && !getString(item, "phase");
  });
  return getRecord(completed?.params, "item");
}

function answerText(notifications: Array<{ method: string; params: unknown }>): string {
  return getString(answerItem(notifications), "text") ?? "";
}

function narrationTexts(notifications: Array<{ method: string; params: unknown }>): string[] {
  return notifications
    .filter((event) => {
      const item = getRecord(event.params, "item");
      return event.method === "item/completed" && getString(item, "id")?.includes(":narration:");
    })
    .map((event) => getString(getRecord(event.params, "item"), "text") ?? "");
}

class TestQueue<T> implements AsyncIterable<T> {
  readonly #values: T[] = [];
  readonly #waiters: Array<(result: IteratorResult<T>) => void> = [];
  #closed = false;

  push(value: T): void {
    const waiter = this.#waiters.shift();
    if (waiter) waiter({ done: false, value });
    else this.#values.push(value);
  }

  close(): void {
    this.#closed = true;
    for (const waiter of this.#waiters.splice(0)) waiter({ done: true, value: undefined });
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const value = this.#values.shift();
        if (value) return Promise.resolve({ done: false, value });
        if (this.#closed) return Promise.resolve({ done: true, value: undefined });
        return new Promise((resolve) => this.#waiters.push(resolve));
      },
    };
  }
}

class TestQuery implements AsyncIterable<TestStreamMessage> {
  closed = false;
  readonly models: Array<string | undefined> = [];
  readonly flagSettings: Array<{
    effortLevel?: "low" | "medium" | "high" | "xhigh" | "max" | null;
  }> = [];

  constructor(
    private readonly output: TestQueue<TestStreamMessage>,
    private readonly supportedModelList: ModelInfo[] | Promise<ModelInfo[]> = [],
    private readonly usageResult: unknown = null,
  ) {}

  [Symbol.asyncIterator](): AsyncIterator<TestStreamMessage> {
    return this.output[Symbol.asyncIterator]();
  }

  async interrupt(): Promise<undefined> {
    return undefined;
  }

  async supportedModels(): Promise<ModelInfo[]> {
    return this.supportedModelList;
  }

  async usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET(): Promise<unknown> {
    return this.usageResult;
  }

  async setModel(model?: string): Promise<void> {
    this.models.push(model);
  }

  async applyFlagSettings(settings: {
    effortLevel?: "low" | "medium" | "high" | "xhigh" | "max" | null;
  }): Promise<void> {
    this.flagSettings.push(settings);
  }

  close(): void {
    this.closed = true;
    this.output.close();
  }
}

async function waitFor(check: () => boolean): Promise<void> {
  await vi.waitFor(() => {
    if (!check()) throw new Error("Timed out waiting for Claude adapter events.");
  });
}

it("hands the enabled MCP servers to the spawn and keeps the bridge names", async () => {
  const query = new TestQuery(new TestQueue<TestStreamMessage>());
  // An array rather than a reassigned variable: the callback runs after this scope is narrowed, so
  // a `let` here would read as `null` to the checker.
  const spawned: DynamicRecord[] = [];
  const mcpServers = [
    mcpConfig({ id: "mcp-1", name: "Filesystem", command: "/bin/echo", args: ["ready"] }),
    mcpConfig({ id: "mcp-2", name: "Disabled", enabled: false }),
    // All four providers key MCP servers by name, so a configuration taking a bridge name would
    // displace the tools the agent depends on.
    mcpConfig({ id: "mcp-3", name: "openbot", command: "/bin/echo" }),
  ];
  const client = new ClaudeAgentClient(
    { executable: "/bin/true", version: "2.1.251" },
    (params) => {
      if (isDynamicRecord(params.options)) spawned.push(params.options);
      return query;
    },
    undefined,
    undefined,
    () => mcpServers,
  );
  client.start();
  try {
    await client.request("thread/start", { cwd: process.cwd() }, decodeThreadResponse);
    const started = spawned.at(-1);
    const servers = isDynamicRecord(started?.mcpServers) ? started.mcpServers : {};
    expect(servers.Filesystem).toMatchObject({ type: "stdio", command: "/bin/echo", args: ["ready"] });
    expect(servers.Disabled).toBeUndefined();
    expect(isDynamicRecord(servers.openbot) ? servers.openbot.instance : null).toBeTruthy();
    /*
     * The record above is the whole set. Without the flag, Claude adds the servers of project
     * `.mcp.json`, user settings, plugins and agent frontmatter to it - including one that takes
     * the bridge name `openbot` - and the panel stops describing what the agent has. The setting
     * sources stay, because the flag takes away MCP and leaves permissions and hooks.
     */
    expect(started?.strictMcpConfig).toBe(true);
    expect(started?.settingSources).toEqual(["user", "project", "local"]);
  } finally {
    await client.stop();
  }
});

// Another provider can write `.claude/settings.json` in the workspace. Its `allowWrite`, `Edit(...)`
// rules and hooks would widen the Workspace only sandbox, so only the skills of that folder load.
it("keeps the workspace settings out of a Workspace only thread and still loads its skills", async () => {
  const query = new TestQuery(new TestQueue<TestStreamMessage>());
  const spawned: DynamicRecord[] = [];
  const root = await mkdtemp(join(tmpdir(), "openbot-claude-workspace-only-"));
  const cwd = join(root, "workspace");
  const client = new ClaudeAgentClient(
    { executable: "/bin/true", version: "2.1.251" },
    (params) => {
      if (isDynamicRecord(params.options)) spawned.push(params.options);
      return query;
    },
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    join(root, "provider-state"),
  );
  client.start();
  try {
    await client.request("thread/start", { cwd, sandbox: "workspace-write" }, decodeThreadResponse);
    const started = spawned.at(-1);
    expect(started?.settingSources).toEqual(["user"]);
    expect(started?.managedSettings).toEqual({ allowManagedHooksOnly: true });
    const plugin = Array.isArray(started?.plugins) ? started.plugins[0] : null;
    const pluginPath = isDynamicRecord(plugin) && isString(plugin.path) ? plugin.path : "";
    expect(isPathInside(join(root, "provider-state"), pluginPath)).toBe(true);
    expect(await readlink(join(pluginPath, "skills"))).toBe(join(cwd, ".claude", "skills"));
  } finally {
    await client.stop();
    await rm(root, { recursive: true, force: true });
  }
});

// Before this, a command this machine does not have produced nothing at all: the adapter skipped
// the server, so the provider never tried to start it and never wrote a word to stderr.
it("reports an MCP server whose command this machine does not have", async () => {
  const query = new TestQuery(new TestQueue<TestStreamMessage>());
  const spawned: DynamicRecord[] = [];
  const reportMcpDrops = vi.fn();
  const client = new ClaudeAgentClient(
    { executable: "/bin/true", version: "2.1.251" },
    (params) => {
      if (isDynamicRecord(params.options)) spawned.push(params.options);
      return query;
    },
    undefined,
    undefined,
    () => [
      mcpConfig({ id: "mcp-1", name: "Filesystem", command: "/bin/echo", args: ["ready"] }),
      mcpConfig({ id: "mcp-2", name: "Missing", command: "openbot-not-a-real-command" }),
    ],
    reportMcpDrops,
  );
  client.start();
  try {
    await client.request("thread/start", { cwd: process.cwd() }, decodeThreadResponse);
    expect(reportMcpDrops).toHaveBeenCalledWith("claude", [
      { name: "Missing", reason: "command_not_found", detail: "Command not found: openbot-not-a-real-command" },
    ]);
    const servers = isDynamicRecord(spawned.at(-1)?.mcpServers) ? spawned.at(-1)?.mcpServers : {};
    expect(isDynamicRecord(servers) ? servers.Missing : null).toBeUndefined();
    // The one that resolves still goes: a bad server must not take a good one with it.
    expect(isDynamicRecord(servers) ? servers.Filesystem : null).toMatchObject({ command: "/bin/echo" });
  } finally {
    await client.stop();
  }
});

// A `npx` or `uvx` from nvm, Homebrew or mise starts with `#!/usr/bin/env node`, so the server needs
// the `PATH` the login shell found it on. An app the user started from Finder inherits none of it.
it("launches an MCP server with this user's own PATH, and lets a configured value win", async () => {
  const query = new TestQuery(new TestQueue<TestStreamMessage>());
  const spawned: DynamicRecord[] = [];
  const client = new ClaudeAgentClient(
    { executable: "/bin/true", version: "2.1.251" },
    (params) => {
      if (isDynamicRecord(params.options)) spawned.push(params.options);
      return query;
    },
    undefined,
    undefined,
    () => [
      mcpConfig({ id: "mcp-1", name: "Filesystem" }),
      mcpConfig({ id: "mcp-2", name: "Own path", env: [{ key: "PATH", value: "/only/here" }] }),
    ],
  );
  client.start();
  try {
    await client.request("thread/start", { cwd: process.cwd() }, decodeThreadResponse);
    const servers = isDynamicRecord(spawned.at(-1)?.mcpServers) ? spawned.at(-1)?.mcpServers : {};
    const environment = (name: string): DynamicRecord => {
      const server = isDynamicRecord(servers) ? servers[name] : null;
      const env = isDynamicRecord(server) ? server.env : null;
      return isDynamicRecord(env) ? env : {};
    };
    const path = await loginShellPath();
    expect(path).toBeTruthy();
    expect(environment("Filesystem").PATH).toBe(path);
    expect(environment("Own path").PATH).toBe("/only/here");
  } finally {
    await client.stop();
  }
});

it("closes the query of a released thread, with the MCP servers it started, and keeps the others", async () => {
  const queries = [
    new TestQuery(new TestQueue<TestStreamMessage>()),
    new TestQuery(new TestQueue<TestStreamMessage>()),
  ];
  const spawned: TestQuery[] = [];
  const client = new ClaudeAgentClient(
    { executable: "/bin/true", version: "2.1.251" },
    () => {
      const next = queries.shift();
      if (!next) throw new Error("Unexpected Claude query.");
      spawned.push(next);
      return next;
    },
    undefined,
    undefined,
    () => [mcpConfig({ id: "mcp-1", name: "Filesystem", command: "/bin/echo" })],
  );
  client.start();
  try {
    const released = await client.request("thread/start", { cwd: process.cwd() }, decodeThreadResponse);
    await client.request("thread/start", { cwd: process.cwd() }, decodeThreadResponse);

    await client.releaseThread(released.thread.id);

    // The query owns the MCP servers of its thread, so this close is what ends those processes.
    expect(spawned[0]?.closed).toBe(true);
    expect(spawned[1]?.closed).toBe(false);
  } finally {
    await client.stop();
  }
});

it("gives a profile-generation thread no MCP servers at all", async () => {
  const query = new TestQuery(new TestQueue<TestStreamMessage>());
  let options: DynamicRecord | null = null;
  const client = new ClaudeAgentClient(
    { executable: "/bin/true", version: "2.1.251" },
    (params) => {
      if (isDynamicRecord(params.options)) options = params.options;
      return query;
    },
    undefined,
    undefined,
    () => [mcpConfig({ id: "mcp-1", name: "Filesystem", command: "/bin/echo" })],
  );
  client.start();
  try {
    await client.request(
      "thread/start",
      { cwd: process.cwd(), profileGeneration: true, persistSession: false },
      decodeThreadResponse,
    );
    expect(options).toMatchObject({ mcpServers: {} });
  } finally {
    await client.stop();
  }
});

function mcpConfig(overrides: Partial<McpServerConfig>): McpServerConfig {
  return {
    id: "mcp-1",
    name: "Filesystem",
    transport: "stdio",
    enabled: true,
    command: "/bin/echo",
    args: [],
    env: [],
    envPassthrough: [],
    workingDirectory: "",
    url: "",
    headers: [],
    ...overrides,
  };
}

it("disables tools, project settings and session persistence for profile generation", async () => {
  const query = new TestQuery(new TestQueue<TestStreamMessage>());
  let options: DynamicRecord | null = null;
  let canUseTool: CanUseTool | undefined;
  const client = new ClaudeAgentClient({ executable: "/bin/true", version: "2.1.251" }, (params) => {
    if (isDynamicRecord(params.options)) options = params.options;
    canUseTool = params.options?.canUseTool;
    return query;
  });
  client.start();
  try {
    await client.request(
      "thread/start",
      { cwd: process.cwd(), profileGeneration: true, persistSession: false },
      decodeThreadResponse,
    );
    expect(options).toMatchObject({ tools: [], settingSources: [], mcpServers: {}, persistSession: false });
    expect(canUseTool).toBeDefined();
    expect(
      await canUseTool?.(
        "Bash",
        { command: "touch should-not-exist" },
        { signal: new AbortController().signal, toolUseID: "tool-1", requestId: "request-1" },
      ),
    ).toMatchObject({ behavior: "deny" });
  } finally {
    await client.stop();
  }
  expect(query.closed).toBe(true);
});
