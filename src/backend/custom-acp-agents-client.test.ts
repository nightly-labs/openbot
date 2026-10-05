import { Effect } from "effect";

import { type ProviderClientOperationError, providerFailure } from "./provider-client-effects";
// @vitest-environment node

import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { isMissingProviderSessionError } from "./agent/thread-items";
import type { AgentClient } from "./agent-client";
import { CustomAcpAgentsClient, type CustomAgentConfig } from "./custom-acp-agents-client";
import { runCauseEffect } from "./effect-boundary";
import type { AppServerNotification, AppServerRequest, RequestId, ResponseDecoder, RpcError } from "./protocol";

interface ClientEvents {
  notification: [notification: AppServerNotification];
  request: [request: AppServerRequest];
  exit: [error: Error];
  diagnostic: [message: string];
}

/** One agent's process: it records what reaches it and answers from `answers`. */
class FakeChild extends EventEmitter<ClientEvents> implements AgentClient {
  readonly provider = "acp" as const;
  running = false;
  readonly requests: { method: string; params: unknown }[] = [];
  readonly responses: { id: RequestId; result: unknown }[] = [];
  readonly errors: { id: RequestId; error: RpcError }[] = [];
  answers: Record<string, () => unknown> = {};

  start(): void {
    this.running = true;
  }

  stop(): Effect.Effect<void, ProviderClientOperationError> {
    return Effect.sync(() => {
      this.running = false;
    });
  }

  request<T>(
    method: string,
    params: unknown,
    decoder: ResponseDecoder<T>,
  ): Effect.Effect<T, ProviderClientOperationError> {
    return Effect.try({
      try: () => {
        this.requests.push({ method, params });
        const answer = this.answers[method];
        return decoder(answer ? answer() : {});
      },
      catch: providerFailure,
    });
  }

  notify(): void {}

  respond(id: RequestId, result: unknown): void {
    this.responses.push({ id, result });
  }

  respondError(id: RequestId, error: RpcError): void {
    this.errors.push({ id, error });
  }
}

function config(id: string): CustomAgentConfig {
  return { id, name: id === "goose" ? "Goose" : "Qwen", command: id, args: [], env: [] };
}

function router(configs: CustomAgentConfig[] = [config("goose"), config("qwen")]) {
  const children = new Map<string, FakeChild>();
  const client = new CustomAcpAgentsClient(
    () => configs,
    (agent) => {
      const child = new FakeChild();
      child.answers["thread/start"] = () => ({ thread: { id: "s1" } });
      children.set(agent.id, child);
      return child;
    },
    (command) => Effect.succeed(`/bin/${command}`),
  );
  client.start();
  return { client, children, configs };
}

const record = (value: unknown) => value;

describe("CustomAcpAgentsClient", () => {
  it("keeps two agents' equal session ids apart, and gives each process its own id and model", async () => {
    const { client, children } = router();
    const goose = await runCauseEffect(client.request("thread/start", { model: "goose/default" }, record));
    const qwen = await runCauseEffect(client.request("thread/start", { model: "qwen/qwen3-coder" }, record));
    expect(goose).toMatchObject({ thread: { id: "goose:s1" } });
    expect(qwen).toMatchObject({ thread: { id: "qwen:s1" } });

    await runCauseEffect(
      client.request("turn/start", { threadId: "qwen:s1", model: "qwen/qwen3-coder", input: [] }, record),
    );
    expect(children.get("qwen")?.requests.at(-1)).toEqual({
      method: "turn/start",
      params: { threadId: "s1", model: "qwen3-coder", input: [] },
    });
    // The default model is no model: the agent uses its own.
    expect(children.get("goose")?.requests.find((entry) => entry.method === "thread/start")?.params).toEqual({});
    expect(children.get("goose")?.requests.some((entry) => entry.method === "turn/start")).toBe(false);
  });

  it("answers each agent's request on its own process, with its own id", async () => {
    const { client, children } = router();
    await runCauseEffect(client.request("thread/start", { model: "goose/default" }, record));
    await runCauseEffect(client.request("thread/start", { model: "qwen/default" }, record));
    const seen: AppServerRequest[] = [];
    client.on("request", (request) => seen.push(request));

    children.get("goose")?.emit("request", { method: "session/request_permission", id: 1, params: { threadId: "s1" } });
    children.get("qwen")?.emit("request", { method: "session/request_permission", id: 1, params: { threadId: "s1" } });
    expect(seen.map((request) => request.params)).toEqual([{ threadId: "goose:s1" }, { threadId: "qwen:s1" }]);
    expect(new Set(seen.map((request) => request.id)).size).toBe(2);

    const [forGoose, forQwen] = seen;
    if (!forGoose || !forQwen) throw new Error("Both requests must arrive.");
    client.respond(forQwen.id, { outcome: "qwen" });
    client.respondError(forGoose.id, { code: -1, message: "no" });
    expect(children.get("qwen")?.responses).toEqual([{ id: 1, result: { outcome: "qwen" } }]);
    expect(children.get("goose")?.responses).toEqual([]);
    expect(children.get("goose")?.errors).toEqual([{ id: 1, error: { code: -1, message: "no" } }]);
  });

  it("reads a session of another agent than the model as missing, so the caller hands over", async () => {
    const { client } = router();
    await runCauseEffect(client.request("thread/start", { model: "goose/default" }, record));
    const error = await runCauseEffect(
      client.request("turn/start", { threadId: "goose:s1", model: "qwen/default", input: [] }, record),
    ).catch((reason: unknown) => reason);
    expect(isMissingProviderSessionError(error, "acp")).toBe(true);
  });

  it("refuses a model of an agent that is not saved", async () => {
    const { client } = router([config("goose")]);
    await expect(runCauseEffect(client.request("thread/start", { model: "qwen/default" }, record))).rejects.toThrow(
      "not saved now",
    );
  });

  it("lists one default model for an agent with no list, drops a bad id, and keeps the last list", async () => {
    const { client, children } = router();
    await runCauseEffect(client.request("thread/start", { model: "goose/default" }, record));
    await runCauseEffect(client.request("thread/start", { model: "qwen/default" }, record));
    const goose = children.get("goose");
    const qwen = children.get("qwen");
    if (!goose || !qwen) throw new Error("Both processes must start.");
    goose.answers["model/list"] = () => ({ data: [] });
    qwen.answers["model/list"] = () => ({
      data: [{ model: "qwen3-coder", displayName: "Qwen3 Coder" }, { model: "bad id with spaces" }],
    });

    const first = await runCauseEffect(client.request("model/list", {}, record));
    expect(first).toMatchObject({
      data: [
        { model: "goose/default", displayName: "Goose" },
        { model: "qwen/qwen3-coder", displayName: "Qwen/Qwen3 Coder" },
      ],
    });

    qwen.answers["model/list"] = () => {
      throw new Error("list failed");
    };
    expect(await runCauseEffect(client.request("model/list", {}, record))).toEqual(first);
  });

  it("stops the router when a process that serves a thread exits", async () => {
    const { client, children } = router();
    await runCauseEffect(client.request("thread/start", { model: "goose/default" }, record));
    const exited = new Promise<Error>((resolve) => client.once("exit", resolve));
    children.get("goose")?.emit("exit", new Error("crashed"));
    await expect(exited).resolves.toMatchObject({ message: "crashed" });
    expect(client.running).toBe(false);
  });

  it("masks a saved environment value that an agent quotes in an error or a diagnostic", async () => {
    const token = "tok-e2e-secret";
    const { client, children } = router([{ ...config("goose"), env: [{ name: "MY_TOKEN", value: token }] }]);
    const diagnostics: string[] = [];
    client.on("diagnostic", (message) => diagnostics.push(message));
    await runCauseEffect(client.request("thread/start", { model: "goose/default" }, record));
    const goose = children.get("goose");
    if (!goose) throw new Error("The process must start.");
    goose.answers["turn/start"] = () => {
      throw new Error(`bad token ${token}`);
    };
    goose.answers["model/list"] = () => {
      throw new Error(`bad token ${token}`);
    };

    await expect(runCauseEffect(client.request("turn/start", { threadId: "goose:s1" }, record))).rejects.toThrow(
      "bad token [redacted]",
    );
    await runCauseEffect(client.request("model/list", {}, record));
    goose.emit("diagnostic", `stderr ${token}`);
    const exited = new Promise<Error>((resolve) => client.once("exit", resolve));
    goose.emit("exit", new Error(`exited with ${token}`));

    expect((await exited).message).toBe("exited with [redacted]");
    expect(diagnostics.length).toBeGreaterThan(1);
    expect(diagnostics.join("\n")).not.toContain(token);
  });
});
