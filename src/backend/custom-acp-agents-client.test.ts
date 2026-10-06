// @vitest-environment node

import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { isMissingProviderSessionError } from "./agent/thread-items";
import type { AgentClient } from "./agent-client";
import { CustomAcpAgentsClient, type CustomAgentConfig } from "./custom-acp-agents-client";
import {
  type AppServerNotification,
  type AppServerRequest,
  decodeRecordResponse,
  getRecord,
  getString,
  type RequestId,
  type ResponseDecoder,
  type RpcError,
} from "./protocol";

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

  async stop(): Promise<void> {
    this.running = false;
  }

  async request<T>(method: string, params: unknown, decoder: ResponseDecoder<T>): Promise<T> {
    this.requests.push({ method, params });
    const answer = this.answers[method];
    return decoder(answer ? answer() : {});
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

const FOLDER = "/work";

/**
 * A router over fake processes. `children` holds each by `<agentId>@<folder>`, and the process that
 * lists an agent's models by `<agentId>@models`; that one answers from `models`.
 */
function router(configs: CustomAgentConfig[] = [config("goose"), config("qwen")]) {
  const children = new Map<string, FakeChild>();
  const models = new Map<string, () => unknown>();
  const client = new CustomAcpAgentsClient(
    () => configs,
    (agent, _executable, folder) => {
      const child = new FakeChild();
      child.answers["thread/start"] = () => ({ thread: { id: "s1" } });
      if (folder === null) child.answers["model/list"] = () => (models.get(agent.id) ?? (() => ({ data: [] })))();
      children.set(`${agent.id}@${folder ?? "models"}`, child);
      return child;
    },
    async (command) => `/bin/${command}`,
  );
  client.start();
  return { client, children, models, configs };
}

const record = (value: unknown) => value;

/** The routed id of a new session. */
async function startThread(client: CustomAcpAgentsClient, model: string, cwd = FOLDER): Promise<string> {
  const response = await client.request("thread/start", { model, cwd }, decodeRecordResponse);
  const id = getString(getRecord(response, "thread"), "id");
  if (id === null) throw new Error("thread/start must give a thread id.");
  return id;
}

describe("CustomAcpAgentsClient", () => {
  it("keeps two agents' equal session ids apart, and gives each process its own id and model", async () => {
    const { client, children } = router();
    const goose = await startThread(client, "goose/default");
    const qwen = await startThread(client, "qwen/qwen3-coder");
    expect(goose).toMatch(/^goose:[0-9a-f]{12}:s1$/);
    expect(qwen).toMatch(/^qwen:[0-9a-f]{12}:s1$/);

    await client.request("turn/start", { threadId: qwen, model: "qwen/qwen3-coder", input: [] }, record);
    expect(children.get(`qwen@${FOLDER}`)?.requests.at(-1)).toEqual({
      method: "turn/start",
      params: { threadId: "s1", model: "qwen3-coder", input: [] },
    });
    // The default model is no model: the agent uses its own.
    expect(children.get(`goose@${FOLDER}`)?.requests.find((entry) => entry.method === "thread/start")?.params).toEqual({
      cwd: FOLDER,
    });
    expect(children.get(`goose@${FOLDER}`)?.requests.some((entry) => entry.method === "turn/start")).toBe(false);
  });

  it("starts one process for each folder of an agent, and lists models on a process of its own", async () => {
    const { client, children } = router([config("goose")]);
    const work = await startThread(client, "goose/default");
    const other = await startThread(client, "goose/default", "/other");
    await client.request("model/list", {}, record);

    expect([...children.keys()]).toEqual([`goose@${FOLDER}`, "goose@/other", "goose@models"]);
    const listedOn = [...children].filter(([, child]) => child.requests.some((entry) => entry.method === "model/list"));
    expect(listedOn.map(([key]) => key)).toEqual(["goose@models"]);

    // Both processes gave `s1`, and each turn still reaches the folder that opened its session.
    expect(work).not.toBe(other);
    await client.request("turn/start", { threadId: work, input: [] }, record);
    await client.request("turn/start", { threadId: other, input: [] }, record);
    for (const key of [`goose@${FOLDER}`, "goose@/other"]) {
      expect(children.get(key)?.requests.filter((entry) => entry.method === "turn/start")).toEqual([
        { method: "turn/start", params: { threadId: "s1", input: [] } },
      ]);
    }
  });

  it("resumes a session saved with no folder in its id, and keeps that id", async () => {
    const { client, children } = router([config("goose")]);
    const seen: AppServerNotification[] = [];
    client.on("notification", (notification) => seen.push(notification));

    await client.request("thread/resume", { threadId: "goose:s9", model: "goose/default", cwd: FOLDER }, record);
    const goose = children.get(`goose@${FOLDER}`);
    expect(goose?.requests.at(-1)).toEqual({ method: "thread/resume", params: { threadId: "s9", cwd: FOLDER } });
    goose?.emit("notification", { method: "item/agentMessage/delta", params: { threadId: "s9" } });
    expect(seen.map((notification) => notification.params)).toEqual([{ threadId: "goose:s9" }]);

    await client.request("turn/start", { threadId: "goose:s9", input: [] }, record);
    expect(goose?.requests.at(-1)).toEqual({ method: "turn/start", params: { threadId: "s9", input: [] } });
  });

  it("resumes a session with a folder in its id after a restart", async () => {
    const saved = await startThread(router([config("goose")]).client, "goose/default");
    const { client, children } = router([config("goose")]);
    await client.request("thread/resume", { threadId: saved, model: "goose/default", cwd: FOLDER }, record);
    expect(children.get(`goose@${FOLDER}`)?.requests.at(-1)).toEqual({
      method: "thread/resume",
      params: { threadId: "s1", cwd: FOLDER },
    });
  });

  it("answers each agent's request on its own process, with its own id", async () => {
    const { client, children } = router();
    const gooseThread = await startThread(client, "goose/default");
    const qwenThread = await startThread(client, "qwen/default");
    const goose = children.get(`goose@${FOLDER}`);
    const qwen = children.get(`qwen@${FOLDER}`);
    const seen: AppServerRequest[] = [];
    client.on("request", (request) => seen.push(request));

    goose?.emit("request", { method: "session/request_permission", id: 1, params: { threadId: "s1" } });
    qwen?.emit("request", { method: "session/request_permission", id: 1, params: { threadId: "s1" } });
    expect(seen.map((request) => request.params)).toEqual([{ threadId: gooseThread }, { threadId: qwenThread }]);
    expect(new Set(seen.map((request) => request.id)).size).toBe(2);

    const [forGoose, forQwen] = seen;
    if (!forGoose || !forQwen) throw new Error("Both requests must arrive.");
    client.respond(forQwen.id, { outcome: "qwen" });
    client.respondError(forGoose.id, { code: -1, message: "no" });
    expect(qwen?.responses).toEqual([{ id: 1, result: { outcome: "qwen" } }]);
    expect(goose?.responses).toEqual([]);
    expect(goose?.errors).toEqual([{ id: 1, error: { code: -1, message: "no" } }]);
  });

  it("reads a session of another agent than the model as missing, so the caller hands over", async () => {
    const { client } = router();
    const goose = await startThread(client, "goose/default");
    const error = await client
      .request("turn/start", { threadId: goose, model: "qwen/default", input: [] }, record)
      .catch((reason: unknown) => reason);
    expect(isMissingProviderSessionError(error, "acp")).toBe(true);
  });

  it("refuses a model of an agent that is not saved", async () => {
    const { client } = router([config("goose")]);
    await expect(client.request("thread/start", { model: "qwen/default", cwd: FOLDER }, record)).rejects.toThrow(
      "not saved now",
    );
  });

  it("lists one default model for an agent with no list, drops a bad id, and keeps the last list", async () => {
    const { client, models } = router();
    models.set("goose", () => ({ data: [] }));
    models.set("qwen", () => ({
      data: [{ model: "qwen3-coder", displayName: "Qwen3 Coder" }, { model: "bad id with spaces" }],
    }));

    const first = await client.request("model/list", {}, record);
    expect(first).toMatchObject({
      data: [
        { model: "goose/default", displayName: "Goose" },
        { model: "qwen/qwen3-coder", displayName: "Qwen/Qwen3 Coder" },
      ],
    });

    models.set("qwen", () => {
      throw new Error("list failed");
    });
    expect(await client.request("model/list", {}, record)).toEqual(first);
  });

  it("stops the router when a process that serves a thread exits, and not when a model list's does", async () => {
    const { client, children } = router([config("goose")]);
    await client.request("thread/start", { model: "goose/default", cwd: FOLDER }, record);
    await client.request("model/list", {}, record);
    const lister = children.get("goose@models");
    lister?.emit("exit", new Error("list process ended"));
    // The next list starts another process, so the first one's exit was handled and did not stop anything.
    await vi.waitFor(async () => {
      await client.request("model/list", {}, record);
      expect(children.get("goose@models")).not.toBe(lister);
    });
    expect(client.running).toBe(true);

    const exited = new Promise<Error>((resolve) => client.once("exit", resolve));
    children.get(`goose@${FOLDER}`)?.emit("exit", new Error("crashed"));
    await expect(exited).resolves.toMatchObject({ message: "crashed" });
    expect(client.running).toBe(false);
  });

  it("masks a saved environment value that an agent quotes in an error or a diagnostic", async () => {
    const token = "tok-e2e-secret";
    const { client, children, models } = router([{ ...config("goose"), env: [{ name: "MY_TOKEN", value: token }] }]);
    const diagnostics: string[] = [];
    client.on("diagnostic", (message) => diagnostics.push(message));
    const thread = await startThread(client, "goose/default");
    const goose = children.get(`goose@${FOLDER}`);
    if (!goose) throw new Error("The process must start.");
    goose.answers["turn/start"] = () => {
      throw new Error(`bad token ${token}`);
    };
    models.set("goose", () => {
      throw new Error(`bad token ${token}`);
    });

    await expect(client.request("turn/start", { threadId: thread }, record)).rejects.toThrow("bad token [redacted]");
    await client.request("model/list", {}, record);
    goose.emit("diagnostic", `stderr ${token}`);
    const exited = new Promise<Error>((resolve) => client.once("exit", resolve));
    goose.emit("exit", new Error(`exited with ${token}`));

    expect((await exited).message).toBe("exited with [redacted]");
    expect(diagnostics.length).toBeGreaterThan(1);
    expect(diagnostics.join("\n")).not.toContain(token);
  });
});
