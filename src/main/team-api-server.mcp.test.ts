// @vitest-environment node

// Who may manage the host machine's MCP servers from a joined server, and what leaves the machine.
// The authority here is deliberate and frozen by `mcp-v1`: an admin can make this machine spawn a
// process, and every reply carries the `env` and header values the host holds. `requireAdmin` is
// the whole gate, so these are the cases that prove it is in place.

import { EventEmitter } from "node:events";
import { decodeMcpServerEntries, type McpServerConfig, type McpServerEntry } from "@openbot/contracts/ipc";
import { afterEach, describe, expect, it } from "vitest";
import {
  createAgents,
  createTeamApiFixture,
  nextJsonEvent,
  stopTeamApiFixtures,
  type TeamApiOptions,
} from "./team-api-server-test-harness";

afterEach(stopTeamApiFixtures);

const config: McpServerConfig = {
  id: "mcp-1",
  name: "Filesystem",
  transport: "stdio",
  enabled: true,
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-filesystem"],
  env: [{ key: "TOKEN", value: "secret" }],
  envPassthrough: ["HOME"],
  workingDirectory: "",
  url: "",
  headers: [],
};

function createMcpServers(): NonNullable<TeamApiOptions["mcpServers"]> & { saved: McpServerConfig[] } {
  const entries: McpServerEntry[] = [];
  const saved: McpServerConfig[] = [];
  return {
    saved,
    listMcpServers: () => entries,
    saveMcpServer: (input) => {
      saved.push(input.config);
      entries.push({ config: input.config, state: "connecting", toolCount: 0, error: null });
      return entries;
    },
    removeMcpServer: (input) => entries.filter((entry) => entry.config.id !== input.mcpServerId),
    setMcpServerEnabled: (input) => {
      for (const entry of entries) if (entry.config.id === input.mcpServerId) entry.config.enabled = input.enabled;
      return entries;
    },
  };
}

describe("Team API MCP server access", () => {
  it("answers only an authenticated admin that negotiated the capability", async () => {
    const mcpServers = createMcpServers();
    const fixture = await createTeamApiFixture("mcp", { configure: true });
    const { base } = await fixture.start({ mcpServers });
    const token = await fixture.signIn();
    const headers = {
      Authorization: `Bearer ${token}`,
      "OpenBot-Protocol-Version": "3",
      "OpenBot-Capabilities": "mcp-servers-v1",
      "Content-Type": "application/json",
    };

    expect(
      (await fetch(`${base}/v1/mcp-servers`, { headers: { ...headers, Authorization: "Bearer bad" } })).status,
    ).toBe(401);
    // Without the capability the routes answer 400 rather than 404: the connection did not ask for
    // the feature, so the host never classifies its paths.
    expect(
      (await fetch(`${base}/v1/mcp-servers`, { headers: { ...headers, "OpenBot-Capabilities": "" } })).status,
    ).toBe(400);

    const invite = await fixture.store.createInvite("member");
    const member = await fixture.store.acceptInvite(invite.token, "member", "member password");
    const asMember = await fetch(`${base}/v1/mcp-servers`, {
      headers: { ...headers, Authorization: `Bearer ${member.sessionToken}` },
    });
    expect(asMember.status).toBe(403);

    const save = await fetch(`${base}/v1/mcp-servers/save`, {
      method: "POST",
      headers,
      body: JSON.stringify({ config }),
    });
    expect(save.status).toBe(200);
    // The decision the wire contract freezes: an admin reads the values the host holds.
    expect(decodeMcpServerEntries(await save.json())[0]?.config.env).toEqual([{ key: "TOKEN", value: "secret" }]);
    expect(mcpServers.saved).toEqual([config]);

    const toggled = await fetch(`${base}/v1/mcp-servers/toggle`, {
      method: "POST",
      headers,
      body: JSON.stringify({ mcpServerId: "mcp-1", enabled: false }),
    });
    expect(decodeMcpServerEntries(await toggled.json())[0]?.config.enabled).toBe(false);

    const removed = await fetch(`${base}/v1/mcp-servers/delete`, {
      method: "POST",
      headers,
      body: JSON.stringify({ mcpServerId: "mcp-1" }),
    });
    expect(decodeMcpServerEntries(await removed.json())).toEqual([]);

    const compatibility = await (await fetch(`${base}/v1/compatibility`)).json();
    expect(compatibility).toMatchObject({ capabilities: expect.arrayContaining(["mcp-servers-v1"]) });
  });

  it("advertises nothing when the host has no MCP service", async () => {
    const fixture = await createTeamApiFixture("mcp-absent", { configure: true });
    const { base } = await fixture.start();
    const compatibility = await (await fetch(`${base}/v1/compatibility`)).json();
    expect(compatibility).toMatchObject({ capabilities: expect.not.arrayContaining(["mcp-servers-v1"]) });
    const token = await fixture.signIn();
    const blocked = await fetch(`${base}/v1/mcp-servers`, {
      headers: { Authorization: `Bearer ${token}`, "OpenBot-Capabilities": "mcp-servers-v1" },
    });
    expect(blocked.status).toBe(400);
  });

  // `eventCapability` returning `null` means "send to everyone", so an unregistered event would
  // leave this machine to every connected peer.
  it("keeps a status push away from a peer that did not negotiate the capability", async () => {
    const events = new EventEmitter();
    const fixture = await createTeamApiFixture("mcp-events", { configure: true });
    const { port } = await fixture.start({ mcpServers: createMcpServers(), agents: createAgents({}, events) });
    const login = await fixture.store.login("owner", "correct horse battery");
    const statuses = [{ id: "mcp-1", state: "failed", toolCount: 0, error: "Command not found: npx" }];

    for (const negotiated of [false, true]) {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/v1/events`, [
        "openbot-team-v1",
        `openbot-token.${login.sessionToken}`,
      ]);
      const presence = nextJsonEvent(socket);
      await new Promise<void>((resolve) => socket.addEventListener("open", () => resolve(), { once: true }));
      await presence;
      // The snapshot the scope message asks for is the acknowledgement that the new capability set
      // is in place, so the emit below cannot race the scope.
      const scoped = nextJsonEvent(socket);
      socket.send(
        JSON.stringify({
          type: "agent-event-scope",
          includeConversations: false,
          capabilities: ["agent-runtime-snapshots", ...(negotiated ? ["mcp-servers-v1"] : [])],
        }),
      );
      await expect(scoped).resolves.toMatchObject({ type: "runtime-snapshot" });
      const next = new Promise<unknown>((resolve) =>
        socket.addEventListener("message", (event) => resolve(JSON.parse(String(event.data))), { once: true }),
      );
      events.emit("event", { type: "mcp-servers-changed", statuses });
      events.emit("event", { type: "agents-changed", agents: [] });
      // The peer without the capability sees the next event instead, which is the proof that the
      // MCP one was dropped rather than merely late.
      await expect(next).resolves.toMatchObject(
        negotiated ? { type: "mcp-servers-changed", statuses } : { type: "bots-changed" },
      );
      const closed = new Promise<void>((resolve) => socket.addEventListener("close", () => resolve(), { once: true }));
      socket.close();
      await closed;
    }
  });
});
