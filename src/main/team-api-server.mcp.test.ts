// @vitest-environment node

// Who may manage the host machine's MCP servers from a joined server, and what leaves the machine.
// The authority here is deliberate and frozen by `mcp-v1`: an admin can make this machine spawn a
// process - a saved one, or one they only described on a test - and every reply carries the `env`
// and header values the host holds. `requireAdmin` is the whole gate, so these are the cases that
// prove it is in place.

import { decodeMcpServerConfigs, decodeMcpTestResult, type McpServerConfig } from "@openbot/contracts/ipc";
import { afterEach, describe, expect, it } from "vitest";
import { createTeamApiFixture, stopTeamApiFixtures, type TeamApiOptions } from "./team-api-server-test-harness";

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

function createMcpServers(): NonNullable<TeamApiOptions["mcpServers"]> & {
  saved: McpServerConfig[];
  tested: McpServerConfig[];
} {
  const stored: McpServerConfig[] = [];
  const saved: McpServerConfig[] = [];
  const tested: McpServerConfig[] = [];
  return {
    saved,
    tested,
    listMcpServers: () => stored,
    saveMcpServer: (input) => {
      saved.push(input.config);
      stored.push(input.config);
      return stored;
    },
    removeMcpServer: (input) => stored.filter((config) => config.id !== input.mcpServerId),
    setMcpServerEnabled: (input) => {
      for (const config of stored) if (config.id === input.mcpServerId) config.enabled = input.enabled;
      return stored;
    },
    testMcpServer: async (input) => {
      tested.push(input.config);
      return { toolCount: 3, error: null };
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
    expect(decodeMcpServerConfigs(await save.json())[0]?.env).toEqual([{ key: "TOKEN", value: "secret" }]);
    expect(mcpServers.saved).toEqual([config]);

    // The other half of that decision: an admin makes this machine connect to a configuration that
    // was never stored, and reads only what the connection found.
    const draft = { ...config, id: "", name: "Draft" };
    const tested = await fetch(`${base}/v1/mcp-servers/test`, {
      method: "POST",
      headers,
      body: JSON.stringify({ config: draft }),
    });
    expect(decodeMcpTestResult(await tested.json())).toEqual({ toolCount: 3, error: null });
    expect(mcpServers.tested).toEqual([draft]);
    expect(
      (
        await fetch(`${base}/v1/mcp-servers/test`, {
          method: "POST",
          headers: { ...headers, Authorization: `Bearer ${member.sessionToken}` },
          body: JSON.stringify({ config: draft }),
        })
      ).status,
    ).toBe(403);

    const toggled = await fetch(`${base}/v1/mcp-servers/toggle`, {
      method: "POST",
      headers,
      body: JSON.stringify({ mcpServerId: "mcp-1", enabled: false }),
    });
    expect(decodeMcpServerConfigs(await toggled.json())[0]?.enabled).toBe(false);

    const removed = await fetch(`${base}/v1/mcp-servers/delete`, {
      method: "POST",
      headers,
      body: JSON.stringify({ mcpServerId: "mcp-1" }),
    });
    expect(decodeMcpServerConfigs(await removed.json())).toEqual([]);

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
});
