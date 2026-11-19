// Checks a change of an agent's account or chat colour from a desktop that is joined to a server.
// The real `updateRemoteAgent` of the `agent:update` handler sends its requests to a fake server
// connection. The fake checks each released Team API body with the released Team protocol v1
// decoder, as a host does, so an empty profile PATCH fails here as it fails on a host
// ("Invalid Team protocol v1 HTTP request.").
// Run: `bun scripts/remote-agent-account-update-e2e.ts`.
// Writes .openbot-build/remote-agent-account-update-e2e/report.json.

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { SetAgentChatColorInput, SetAgentColorInput, UpdateAgentInput } from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { AGENT_COLORS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-colors-v1";
import { CHAT_COLORS_CAPABILITY } from "@openbot/contracts/team-protocol/chat-colors-v1";
import {
  PROVIDER_ACCOUNTS_CAPABILITY,
  PROVIDER_ACCOUNTS_ROUTES,
} from "@openbot/contracts/team-protocol/provider-accounts-v1";
import { decodeTeamProtocolV1HttpRequest } from "@openbot/contracts/team-protocol/v1";
import { plugin } from "bun";
import { Effect } from "effect";
import type { ResponseDecoder } from "../src/main/remote-host-decoding";
import type { RemoteRequestInit } from "../src/main/remote-server-client";
import { RemoteWorkflowError } from "../src/main/remote-service-effects";

const OUT = resolve(import.meta.dirname, "../.openbot-build/remote-agent-account-update-e2e");
const SERVER_ID = "joined-server";
const AGENT_ID = "agent-1";
const ACCOUNT_ID = "a0123456789abcdef";

// The handler module imports Electron through the main process. No check here opens a window.
plugin({
  name: "remote-agent-account-update-electron-boundary",
  setup(build) {
    class Inert {}
    build.module("electron", () => ({
      loader: "object",
      exports: {
        app: { getPath: () => tmpdir(), getVersion: () => "0.0.0-e2e", isPackaged: false, on: () => undefined },
        BrowserWindow: class extends Inert {
          static getAllWindows() {
            return [];
          }
        },
        MessageChannelMain: class extends Inert {},
        Notification: class extends Inert {},
        clipboard: {},
        desktopCapturer: {},
        dialog: {},
        ipcMain: { handle: () => undefined, removeHandler: () => undefined, on: () => undefined },
        nativeImage: {},
        net: {},
        powerMonitor: { on: () => undefined },
        safeStorage: { isEncryptionAvailable: () => false },
        screen: { getAllDisplays: () => [] },
        session: {},
        shell: { openExternal: async () => undefined },
        systemPreferences: {},
        webContents: { getAllWebContents: () => [] },
      },
    }));
  },
});
const { updateRemoteAgent } = await import("../src/main/ipc/agent-handlers");
type RemoteAgentUpdateServers = Parameters<typeof updateRemoteAgent>[0];

interface SentRequest {
  method: string;
  path: string;
  body: unknown;
}

/** The agent as a host lists it. */
function hostAgent(name: string) {
  return {
    id: AGENT_ID,
    provider: "codex",
    name,
    title: "",
    description: "",
    notifications: true,
    model: "gpt-5",
    reasoningEffort: "high",
    threadId: `openbot-thread-${AGENT_ID}`,
    workspacePath: "/tmp/agent-1",
    preview: "",
    updatedAt: "2026-11-05T00:00:00.000Z",
    avatarSeed: "seed",
    avatarHue: null,
    avatarUrl: null,
  };
}

/** A joined server with the given capabilities. It records each request and checks Team API bodies. */
function fakeServer(capabilities: readonly string[]) {
  const sent: SentRequest[] = [];
  const chatColors: SetAgentChatColorInput[] = [];
  const agentColors: SetAgentColorInput[] = [];
  let name = "Ada";
  const respond = <T>(path: string, decoder: ResponseDecoder<T>, init: RemoteRequestInit): T => {
    const method = init.method ?? "GET";
    sent.push({ method, path, body: init.body });
    if (method === "GET" && path === TEAM_API_ROUTES.agents.all) return decoder([hostAgent(name)]);
    if (method === "PATCH" && path === TEAM_API_ROUTES.agent.one(AGENT_ID)) {
      // A host refuses this body before it reaches the agent store.
      const body = decodeTeamProtocolV1HttpRequest(method, path, init.body);
      if (typeof body.name === "string") name = body.name;
      return decoder(hostAgent(name));
    }
    if (method === "POST" && path === PROVIDER_ACCOUNTS_ROUTES.agent) return decoder(undefined);
    throw new Error(`Unexpected request ${method} ${path}.`);
  };
  const remoteServers: RemoteAgentUpdateServers = {
    supportsCapability: (serverId, capability) => serverId === SERVER_ID && capabilities.includes(capability),
    request: (serverId, path, decoder, init = {}) =>
      Effect.try({
        try: () => {
          assert.equal(serverId, SERVER_ID);
          return respond(path, decoder, init);
        },
        catch: (cause) => new RemoteWorkflowError({ cause }),
      }),
    setAgentChatColor: (_serverId, input) => Effect.sync(() => void chatColors.push(input)),
    setAgentColor: (_serverId, input) => Effect.sync(() => void agentColors.push(input)),
    readAgentColors: () => Effect.void,
    agentWithColor: (_serverId, agent) => agent,
  };
  const update = (input: UpdateAgentInput) => updateRemoteAgent(remoteServers, SERVER_ID, input);
  const requests = () => sent.map(({ method, path }) => `${method} ${path}`);
  return { update, sent, requests, chatColors, agentColors };
}

const report: { passed: boolean; steps: { name: string; passed: boolean; detail?: unknown; error?: string }[] } = {
  passed: false,
  steps: [],
};

async function step<T>(name: string, run: () => Promise<T>): Promise<T> {
  process.stdout.write(`- ${name}\n`);
  try {
    const value = await run();
    report.steps.push({ name, passed: true, detail: value });
    return value;
  } catch (error) {
    report.steps.push({ name, passed: false, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

try {
  await step("A host refuses a profile PATCH without a profile field", async () => {
    assert.throws(
      () => decodeTeamProtocolV1HttpRequest("PATCH", TEAM_API_ROUTES.agent.one(AGENT_ID), { agentId: AGENT_ID }),
      /Invalid Team protocol v1 HTTP request\./,
    );
    return { refused: true };
  });

  await step("A change of only the account reaches the account route", async () => {
    const server = fakeServer([PROVIDER_ACCOUNTS_CAPABILITY]);
    const agent = await server.update({ agentId: AGENT_ID, providerAccountId: ACCOUNT_ID });
    assert.deepEqual(server.requests(), [
      `GET ${TEAM_API_ROUTES.agents.all}`,
      `POST ${PROVIDER_ACCOUNTS_ROUTES.agent}`,
    ]);
    assert.deepEqual(server.sent[1]?.body, { agentId: AGENT_ID, accountId: ACCOUNT_ID });
    assert.equal(agent.id, AGENT_ID);
    assert.equal(agent.providerAccountId, ACCOUNT_ID);
    return { requests: server.requests() };
  });

  await step("A change of the name and the account sends both", async () => {
    const server = fakeServer([PROVIDER_ACCOUNTS_CAPABILITY]);
    const agent = await server.update({ agentId: AGENT_ID, name: "Grace", providerAccountId: ACCOUNT_ID });
    assert.deepEqual(server.requests(), [
      `PATCH ${TEAM_API_ROUTES.agent.one(AGENT_ID)}`,
      `POST ${PROVIDER_ACCOUNTS_ROUTES.agent}`,
    ]);
    assert.equal(agent.name, "Grace");
    assert.equal(agent.providerAccountId, ACCOUNT_ID);
    return { requests: server.requests() };
  });

  await step("A change of only the chat colour sends no profile PATCH", async () => {
    const server = fakeServer([CHAT_COLORS_CAPABILITY]);
    const agent = await server.update({ agentId: AGENT_ID, chatColor: "#8b5cf6" });
    assert.deepEqual(server.chatColors, [{ agentId: AGENT_ID, color: "#8b5cf6" }]);
    assert.deepEqual(server.requests(), [`GET ${TEAM_API_ROUTES.agents.all}`]);
    assert.equal(agent.id, AGENT_ID);
    return { requests: server.requests() };
  });

  await step("A change of only the agent colour sends no profile PATCH", async () => {
    const server = fakeServer([AGENT_COLORS_CAPABILITY]);
    const agent = await server.update({ agentId: AGENT_ID, avatarColor: "#8b5cf6" });
    assert.deepEqual(server.agentColors, [{ agentId: AGENT_ID, color: "#8b5cf6" }]);
    assert.deepEqual(server.requests(), [`GET ${TEAM_API_ROUTES.agents.all}`]);
    assert.equal(agent.id, AGENT_ID);
    return { requests: server.requests() };
  });

  await step("A chat colour for a host without chat colours still fails", async () => {
    const server = fakeServer([]);
    await assert.rejects(server.update({ agentId: AGENT_ID, chatColor: "#8b5cf6" }), /chat colou?r/i);
    assert.deepEqual(server.requests(), []);
    return { requests: server.requests() };
  });

  await step("A change with nothing for the host to do still fails", async () => {
    // An agent colour without its capability and without a hue changes nothing, as before the fix.
    const server = fakeServer([]);
    await assert.rejects(
      server.update({ agentId: AGENT_ID, avatarColor: "#8b5cf6" }),
      /Invalid Team protocol v1 HTTP request\./,
    );
    assert.deepEqual(server.agentColors, []);
    return { requests: server.requests() };
  });

  await step("An account change for an agent the host does not list fails", async () => {
    const server = fakeServer([PROVIDER_ACCOUNTS_CAPABILITY]);
    await assert.rejects(
      server.update({ agentId: "agent-missing", providerAccountId: ACCOUNT_ID }),
      /Agent not found\./,
    );
    assert.ok(!server.sent.some(({ method }) => method === "POST"), "The account route ran for a missing agent.");
    return { requests: server.requests() };
  });

  report.passed = true;
} finally {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`Report: ${join(OUT, "report.json")}\n`);
}
