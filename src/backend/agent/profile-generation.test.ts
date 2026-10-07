import { EventEmitter } from "node:events";
import { access } from "node:fs/promises";
import { type AgentProfileDraft, AVATAR_HUES } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { expect, it, vi } from "vitest";
import type { AgentClient } from "../agent-client";
import { runCauseEffect } from "../effect-boundary";
import { getString, type RequestId, type ResponseDecoder, type RpcError } from "../protocol";
import { type ProviderClientOperationError, providerFailure } from "../provider-client-effects";
import { ProfileClients } from "./profile-clients";
import { generateProfile, generateTextWithoutTools, profilePrompt } from "./profile-generation";

const draft: AgentProfileDraft = {
  name: "Researcher",
  title: "Research assistant",
  description: "Compare primary sources.",
  avatarSeed: "profile:research",
  avatarHue: 215,
  sectionId: null,
};
const model = {
  id: "gpt-5.6-luna",
  provider: "codex",
  name: "Luna",
  description: "",
  defaultReasoningEffort: "medium",
  supportedReasoningEfforts: ["medium"],
} as const;
class ProfileClient extends EventEmitter implements AgentClient {
  readonly provider = "codex";
  running = false;
  cwd = "";
  denied = false;
  constructor(
    readonly output: string,
    readonly toolRequest = false,
  ) {
    super();
  }
  starts = 0;
  start() {
    this.starts += 1;
    this.running = true;
  }
  stop() {
    return Effect.sync(() => {
      this.running = false;
    });
  }
  notify() {}
  respond(_id: RequestId, _result: unknown) {}
  respondError(_id: RequestId, _error: RpcError) {
    this.denied = true;
  }
  request<T>(
    method: string,
    params: unknown,
    decode: ResponseDecoder<T>,
  ): Effect.Effect<T, ProviderClientOperationError> {
    return Effect.try({
      try: () => {
        if (method === "thread/start") {
          this.cwd = getString(params, "cwd") ?? "";
          return decode({ thread: { id: "draft-thread" } });
        }
        if (method === "turn/start") {
          if (this.toolRequest) this.emit("request", { id: 1, method: "item/tool/call", params: {} });
          else {
            this.emit("notification", { method: "item/agentMessage/delta", params: { delta: this.output } });
            this.emit("notification", { method: "turn/completed", params: { turn: { status: "completed" } } });
          }
          return decode({ turn: { id: "draft-turn" } });
        }
        return decode({});
      },
      catch: providerFailure,
    });
  }
}

it("returns editable generated fields and removes the disposable workspace and provider process", async () => {
  const client = new ProfileClient(JSON.stringify(draft));
  expect(
    await runCauseEffect(
      generateProfile(
        client,
        { ...model, supportedReasoningEfforts: ["medium"] },
        { prompt: "Research assistant" },
        [],
      ),
    ),
  ).toEqual(draft);
  expect(client.running).toBe(false);
  await expect(access(client.cwd)).rejects.toThrow();
});

// An endpoint removed while the disposable workspace is made finds a client with no process, so
// stopping it reaches nothing. Only the generation itself can keep the old endpoint unspawned.
it("spawns no process for a generation cancelled while its workspace was made", async () => {
  const client = new ProfileClient(JSON.stringify(draft));
  await expect(
    runCauseEffect(
      generateProfile(
        client,
        { ...model, supportedReasoningEfforts: ["medium"] },
        { prompt: "Research assistant" },
        [],
        () => true,
      ),
    ),
  ).rejects.toThrow("The custom endpoints changed while this was generating. Try again.");
  expect(client.starts).toBe(0);
  // No session was opened either, so the removed endpoint was never asked for anything.
  expect(client.cwd).toBe("");
});

it.each([
  "not JSON",
  JSON.stringify({ ...draft, description: "x".repeat(2001) }),
  JSON.stringify({ ...draft, avatarHue: 20 }),
  JSON.stringify({ ...draft, sectionId: "missing" }),
])("rejects unusable generation without leaving its process running: %s", async (output) => {
  const client = new ProfileClient(output);
  await expect(
    runCauseEffect(
      generateProfile(
        client,
        { ...model, supportedReasoningEfforts: ["medium"] },
        { prompt: "Research assistant" },
        [],
      ),
    ),
  ).rejects.toThrow();
  expect(client.running).toBe(false);
  await expect(access(client.cwd)).rejects.toThrow();
});

it("denies provider tool requests instead of executing the setup prompt", async () => {
  const client = new ProfileClient("", true);
  await expect(
    runCauseEffect(
      generateProfile(client, { ...model, supportedReasoningEfforts: ["medium"] }, { prompt: "Run a command" }, []),
    ),
  ).rejects.toThrow("attempted to use a tool");
  expect(client.denied).toBe(true);
  expect(client.running).toBe(false);
});

it("revises from the current draft using the existing avatar palette", () => {
  const prompt = profilePrompt({ prompt: "Focus on science", draft }, []);
  expect(prompt).toContain(JSON.stringify(draft));
  expect(prompt).toContain(AVATAR_HUES.join(","));
});

it("aborts a channel generation that has started without waiting for its timeout", async () => {
  const client = new ProfileClient("");
  const original = client.request.bind(client);
  let started = false;
  vi.spyOn(client, "request").mockImplementation((method, params, decode) => {
    if (method === "turn/start") {
      return Effect.sync(() => {
        started = true;
        return decode({ turn: { id: "waiting" } });
      });
    }
    return original(method, params, decode);
  });
  const abort = new AbortController();
  const generation = runCauseEffect(
    generateTextWithoutTools(
      client,
      { ...model, supportedReasoningEfforts: ["medium"] },
      "Status",
      () => false,
      abort.signal,
    ),
  );
  const stopped = expect(generation).rejects.toThrow();
  await vi.waitFor(() => expect(started).toBe(true));
  abort.abort();
  await stopped;
  expect(client.running).toBe(false);
  await expect(access(client.cwd)).rejects.toThrow();
});

it("bounds disposable sessions and cancels queued channel work before it can start", async () => {
  const clients = new ProfileClients();
  const finish: (() => void)[] = [];
  const active = Array.from({ length: 3 }, () =>
    runCauseEffect(
      clients.run(new ProfileClient(""), () =>
        Effect.promise(() => new Promise<void>((resolve) => finish.push(resolve))),
      ),
    ),
  );
  await vi.waitFor(() => expect(finish).toHaveLength(3));
  const abort = new AbortController();
  const cancelledClient = new ProfileClient("{}");
  const queued = runCauseEffect(
    clients.run(
      cancelledClient,
      (cancelled) =>
        generateTextWithoutTools(
          cancelledClient,
          { ...model, supportedReasoningEfforts: ["medium"] },
          "Status",
          cancelled,
          abort.signal,
        ),
      abort.signal,
    ),
  );
  const rejected = expect(queued).rejects.toThrow();
  expect(cancelledClient.starts).toBe(0);
  abort.abort();
  await rejected;
  expect(cancelledClient.starts).toBe(0);
  const waitingClient = new ProfileClient("Status");
  const waiting = runCauseEffect(
    clients.run(waitingClient, (cancelled) =>
      generateTextWithoutTools(waitingClient, { ...model, supportedReasoningEfforts: ["medium"] }, "Status", cancelled),
    ),
  );
  expect(waitingClient.starts).toBe(0);
  finish[0]?.();
  await expect(waiting).resolves.toBe("Status");
  for (const release of finish) release();
  await Promise.all(active);
  expect(clients.count()).toBe(0);
});
