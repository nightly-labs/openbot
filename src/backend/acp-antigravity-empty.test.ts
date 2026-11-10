import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runTurn, startThread } from "../../scripts/provider-fakes/host";
import { AcpAgentClient } from "./acp-client";
import type { AcpConnectionOptions } from "./acp-connection";
import { ANTIGRAVITY_ACP_FLAVOR } from "./acp-flavor-antigravity";
import { runCauseEffect } from "./effect-boundary";

const fake = vi.hoisted((): { mode: string; calls: string[]; count: number } => ({
  mode: "empty",
  calls: [],
  count: 0,
}));

vi.mock("./acp-connection", () => ({
  AcpConnection: class {
    running = false;
    ended = null;
    connection;
    constructor(options: AcpConnectionOptions) {
      const setup = {
        sessionId: "session",
        models: { availableModels: [{ modelId: "fake", name: "Fake" }], currentModelId: "fake" },
      };
      this.connection = {
        initialize: async () => ({
          protocolVersion: 1,
          agentCapabilities: { sessionCapabilities: {} },
          authMethods: [],
        }),
        newSession: async () => setup,
        closeSession: async () => ({}),
        resumeSession: async () => {
          fake.calls.push("resume");
          return setup;
        },
        cancel: async () => {
          fake.calls.push("cancel");
        },
        prompt: async ({ sessionId }: { sessionId: string }) => {
          fake.calls.push("prompt");
          fake.count += 1;
          if (fake.mode === "empty") return { stopReason: "end_turn" };
          if (fake.count === 1 || fake.mode === "twice") return new Promise(() => {});
          await options.client().sessionUpdate({
            sessionId,
            update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "ok" } },
          });
          return { stopReason: "end_turn" };
        },
      };
    }
    start() {
      this.running = true;
    }
    requireConnection() {
      return this.connection;
    }
    stop(cleanup: Effect.Effect<void>) {
      this.running = false;
      return cleanup;
    }
    explainEnd(error: unknown) {
      return Effect.succeed(error);
    }
  },
}));

describe("Antigravity empty ACP turns", () => {
  let client: AcpAgentClient;
  beforeEach(() => {
    fake.mode = "empty";
    fake.calls = [];
    fake.count = 0;
    client = new AcpAgentClient({ executable: "fake", version: "1", source: "managed" }, 2000, {
      provider: "antigravity",
      flavor: ANTIGRAVITY_ACP_FLAVOR,
      argv: [],
      env: {},
      signInMessage: "sign in",
      firstUpdateMs: 30,
    });
    client.start();
  });
  afterEach(async () => {
    await runCauseEffect(client.stop());
  });

  it("fails an end_turn with no output", async () => {
    const thread = await startThread(client, { cwd: process.cwd() });
    const turn = await runTurn(client, thread, { timeoutMs: 2000 });
    expect(turn.status).toBe("failed");
    expect(turn.error).toBe(sourceText("error.provider.acpNoAnswer", { provider: "Gemini" }));
  });

  it("resumes and retries a silent prompt without advertised resume", async () => {
    fake.mode = "retry";
    const thread = await startThread(client, { cwd: process.cwd() });
    const turn = await runTurn(client, thread, { timeoutMs: 2000 });
    expect(turn.status).toBe("completed");
    expect(turn.reply).toBe("ok");
    expect(fake.calls).toEqual(["prompt", "cancel", "resume", "prompt"]);
  });

  it("fails after two silent prompts and resumes for the next turn", async () => {
    fake.mode = "twice";
    const thread = await startThread(client, { cwd: process.cwd() });
    const turn = await runTurn(client, thread, { timeoutMs: 2000 });
    expect(turn.status).toBe("failed");
    expect(turn.error).toBe(sourceText("error.agent.turnStalled", { provider: "Gemini" }));
    expect(fake.calls).toEqual(["prompt", "cancel", "resume", "prompt", "cancel"]);
    fake.mode = "retry";
    const next = await runTurn(client, thread, { timeoutMs: 2000 });
    expect(next.status).toBe("completed");
    expect(next.reply).toBe("ok");
    expect(fake.calls.slice(-2)).toEqual(["resume", "prompt"]);
  });
});
