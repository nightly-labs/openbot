import { Effect } from "effect";
// @vitest-environment node

import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { registerSecretValue } from "@openbot/logging";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AUTOMATION_HEADERS_FILE, AUTOMATION_TOKEN_FILE, AUTOMATION_URL_FILE } from "../backend/automation-command";
import { AUTOMATION_RUNS_PER_HOUR, AutomationServer, type AutomationServerOptions } from "./automation-server";

const FILES = [AUTOMATION_URL_FILE, AUTOMATION_TOKEN_FILE, AUTOMATION_HEADERS_FILE];

interface Reply {
  status: number;
  body: unknown;
}

const servers: AutomationServer[] = [];
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => Effect.runPromise(server.stop())));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function startServer(overrides: Partial<AutomationServerOptions> = {}) {
  const root = join(await mkdtemp(join(tmpdir(), "openbot-automation-")), "automation");
  roots.push(join(root, ".."));
  const agents: { id: string; name: string; allowAutomation?: boolean }[] = [
    { id: "agent-1", name: "Ada", allowAutomation: true },
  ];
  const runRoutine = vi.fn<AutomationServerOptions["runRoutine"]>(() =>
    Effect.succeed({ id: "run-1", deliveryId: "d-1" }),
  );
  const server = new AutomationServer({
    root,
    listAgents: () => agents,
    listRoutines: (agentId) => (agentId === "agent-1" ? [{ id: "routine-1", name: "Wake", active: false }] : []),
    runRoutine,
    sendMessage: () => Effect.succeed({ messageId: "message-1", deliveries: [] }),
    getLocalAttention: () => ({ prompts: [], approvals: [], browserTakeovers: [] }),
    respondToLocalAttention: () => Effect.void,
    ...overrides,
  });
  servers.push(server);
  await Effect.runPromise(server.sync());
  const url = (await readFile(join(root, AUTOMATION_URL_FILE), "utf8")).trim();
  const token = (await readFile(join(root, AUTOMATION_TOKEN_FILE), "utf8")).trim();
  return { server, root, agents, runRoutine, url, token };
}

/** `fetch` cannot set `Host` or always send `Origin`, so the gate tests use `http.request`. */
function send(
  url: string,
  path: string,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const outgoing = request(`${url}${path}`, { method: options.method ?? "GET", headers: options.headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({ status: res.statusCode ?? 0, body: text ? JSON.parse(text) : null });
      });
    });
    outgoing.on("error", reject);
    outgoing.end(options.body);
  });
}

function run(url: string, token: string, body: unknown, path = "/v1/agents/agent-1/routines/routine-1/run") {
  return send(url, path, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("AutomationServer", () => {
  it("checks agent access on every message, pending read, and response", async () => {
    const sendMessage = vi.fn<AutomationServerOptions["sendMessage"]>(() =>
      Effect.succeed({ messageId: "m", deliveries: [] }),
    );
    const getLocalAttention = vi.fn<AutomationServerOptions["getLocalAttention"]>(() => ({
      prompts: [],
      approvals: [],
      browserTakeovers: [],
    }));
    const respondToLocalAttention = vi.fn<AutomationServerOptions["respondToLocalAttention"]>(() => Effect.void);
    const { url, token, agents } = await startServer({ sendMessage, getLocalAttention, respondToLocalAttention });
    agents.push({ id: "agent-2", name: "Off" });
    for (const agentId of ["agent-2", "missing"]) {
      const status = agentId === "missing" ? 404 : 403;
      expect(
        (await send(url, `/v1/agents/${agentId}/pending`, { headers: { authorization: `Bearer ${token}` } })).status,
      ).toBe(status);
      for (const route of ["messages", "prompts/request-1/answer", "approvals/request-1/respond"]) {
        expect(
          (
            await run(
              url,
              token,
              { text: "work", clientMessageId: "retry-1", answers: {}, decision: "accept" },
              `/v1/agents/${agentId}/${route}`,
            )
          ).status,
        ).toBe(status);
      }
    }
    expect(sendMessage).not.toHaveBeenCalled();
    expect(getLocalAttention).not.toHaveBeenCalled();
    expect(respondToLocalAttention).not.toHaveBeenCalled();
    expect(
      (await run(url, token, { text: "work", clientMessageId: "retry-1" }, "/v1/agents/agent-1/messages")).status,
    ).toBe(202);
    expect(sendMessage).toHaveBeenCalledWith({
      agentId: "agent-1",
      text: "work",
      clientMessageId: "automation:retry-1",
    });
    expect(
      (await run(url, token, { answers: { q: ["Yes"] } }, "/v1/agents/agent-1/prompts/request-1/answer")).status,
    ).toBe(200);
    expect(respondToLocalAttention).toHaveBeenCalledWith("agent-1", {
      kind: "prompt",
      requestId: "request-1",
      answers: { q: ["Yes"] },
    });
  });

  it("redacts pending text and omits secret questions", async () => {
    const secret = "automation-test-private-value";
    registerSecretValue(secret);
    const { url, token } = await startServer({
      getLocalAttention: () => ({
        prompts: [
          {
            requestId: "public",
            requiresOpenBot: false,
            questions: [{ id: "q", header: "Question", question: `Use ${secret}?`, isSecret: false, options: null }],
          },
          {
            requestId: "private",
            requiresOpenBot: true,
            questions: [
              { id: "q", header: "Secret", question: "unregistered-private-value", isSecret: true, options: null },
            ],
          },
        ],
        approvals: [],
        browserTakeovers: [{ requestId: "browser", requiresOpenBot: true }],
      }),
    });
    const reply = await send(url, "/v1/agents/agent-1/pending", { headers: { authorization: `Bearer ${token}` } });
    expect(reply.status).toBe(200);
    expect(JSON.stringify(reply.body)).not.toContain(secret);
    expect(JSON.stringify(reply.body)).not.toContain("unregistered-private-value");
    expect(reply.body).toMatchObject({
      prompts: [{ requestId: "public" }, { requestId: "private", questions: [], requiresOpenBot: true }],
    });
  });

  it("rejects invalid and oversized bodies before sending work", async () => {
    const sendMessage = vi.fn<AutomationServerOptions["sendMessage"]>(() =>
      Effect.succeed({ messageId: "m", deliveries: [] }),
    );
    const { url, token } = await startServer({ sendMessage });
    const path = "/v1/agents/agent-1/messages";
    expect((await run(url, token, { text: "work" }, path)).status).toBe(400);
    expect((await run(url, token, { text: "x".repeat(33 * 1024), clientMessageId: "retry" }, path)).status).toBe(413);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("refuses a message when Local scripts is disabled during upload", async () => {
    let enabled = true;
    const listAgents = vi.fn(() => [{ id: "agent-1", name: "Ada", allowAutomation: enabled }]);
    const sendMessage = vi.fn<AutomationServerOptions["sendMessage"]>(() =>
      Effect.succeed({ messageId: "m", deliveries: [] }),
    );
    const { url, token } = await startServer({ listAgents, sendMessage });
    listAgents.mockClear();
    const upload = request(`${url}/v1/agents/agent-1/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    });
    const reply = new Promise<number | undefined>((resolve, reject) => {
      upload.on("error", reject);
      upload.on("response", (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode));
      });
    });
    upload.write('{"text":"work",');
    await vi.waitFor(() => expect(listAgents).toHaveBeenCalled());
    enabled = false;
    upload.end('"clientMessageId":"retry"}');
    expect(await reply).toBe(403);
    expect(sendMessage).not.toHaveBeenCalled();
  });
  it("runs the routine with the payload and answers with the run ids", async () => {
    const { url, token, runRoutine } = await startServer();

    const reply = await run(url, token, { payload: "build finished: ok" });

    expect(reply).toEqual({ status: 202, body: { runId: "run-1", deliveryId: "d-1" } });
    expect(runRoutine).toHaveBeenCalledWith({
      agentId: "agent-1",
      routineId: "routine-1",
      payload: "build finished: ok",
    });
  });

  it("lists only the agents that allow local scripts", async () => {
    const { url, token, agents } = await startServer();
    agents.push({ id: "agent-2", name: "Off" });

    const reply = await send(url, "/v1/agents", { headers: { authorization: `Bearer ${token}` } });

    expect(reply).toEqual({
      status: 200,
      body: [{ id: "agent-1", name: "Ada", routines: [{ id: "routine-1", name: "Wake", active: false }] }],
    });
  });

  it("refuses a request without the token or with a wrong one", async () => {
    const { url, token, runRoutine } = await startServer();

    expect((await run(url, "", {})).status).toBe(401);
    expect((await run(url, `${token.slice(1)}x`, {})).status).toBe(401);
    expect((await send(url, "/v1/agents")).status).toBe(401);
    expect(runRoutine).not.toHaveBeenCalled();
  });

  it("refuses a browser request and a foreign Host before it reads the token", async () => {
    const { url, token, runRoutine } = await startServer();
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const path = "/v1/agents/agent-1/routines/routine-1/run";

    const withOrigin = await send(url, path, {
      method: "POST",
      headers: { ...headers, origin: "https://example.com" },
      body: "{}",
    });
    const rebound = await send(url, path, {
      method: "POST",
      headers: { ...headers, host: `attacker.example:${new URL(url).port}` },
      body: "{}",
    });

    expect(withOrigin.status).toBe(403);
    expect(rebound.status).toBe(403);
    expect(runRoutine).not.toHaveBeenCalled();
  });

  it("refuses an agent that does not allow local scripts, and unknown agents and routines", async () => {
    const { url, token, agents, runRoutine } = await startServer();
    agents.push({ id: "agent-2", name: "Off" });

    expect((await run(url, token, {}, "/v1/agents/agent-2/routines/routine-1/run")).status).toBe(403);
    expect((await run(url, token, {}, "/v1/agents/missing/routines/routine-1/run")).status).toBe(404);
    expect((await run(url, token, {}, "/v1/agents/agent-1/routines/missing/run")).status).toBe(404);
    expect(runRoutine).not.toHaveBeenCalled();
  });

  it("refuses a payload over the limit", async () => {
    const { url, token, runRoutine } = await startServer();

    const reply = await run(url, token, { payload: "x".repeat(INPUT_LIMITS.automationPayload + 1) });

    expect(reply.status).toBe(413);
    expect(runRoutine).not.toHaveBeenCalled();
  });

  it("limits the runs of one agent in one hour", async () => {
    let now = 1_000_000;
    const { url, token, runRoutine } = await startServer({ now: () => now });

    for (let index = 0; index < AUTOMATION_RUNS_PER_HOUR; index += 1) {
      expect((await run(url, token, {})).status).toBe(202);
    }
    expect((await run(url, token, {})).status).toBe(429);
    now += 60 * 60 * 1000;
    expect((await run(url, token, {})).status).toBe(202);
    expect(runRoutine).toHaveBeenCalledTimes(AUTOMATION_RUNS_PER_HOUR + 1);
  });

  it.skipIf(process.platform === "win32")("keeps the token where only this user can read it", async () => {
    const { root } = await startServer();

    expect((await stat(root)).mode & 0o777).toBe(0o700);
    for (const name of FILES) expect((await stat(join(root, name))).mode & 0o777).toBe(0o600);
  });

  it("stops and removes its files when the last agent turns local scripts off", async () => {
    const { server, root, agents, url, token } = await startServer();

    agents[0] = { id: "agent-1", name: "Ada", allowAutomation: false };
    await Effect.runPromise(server.sync());

    for (const name of FILES) await expect(stat(join(root, name))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(run(url, token, {})).rejects.toMatchObject({ code: "ECONNREFUSED" });

    agents[0] = { id: "agent-1", name: "Ada", allowAutomation: true };
    await Effect.runPromise(server.sync());
    const nextUrl = (await readFile(join(root, AUTOMATION_URL_FILE), "utf8")).trim();
    expect((await run(nextUrl, token, {})).status).toBe(401);
  });
});
