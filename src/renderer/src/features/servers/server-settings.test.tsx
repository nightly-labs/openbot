import type { McpServerEntry } from "@openbot/contracts/ipc";
import { render, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { createMockOpenBot, type MockOpenBotControls } from "../../preview/mock-openbot";
import { ServerSettingsProvider, useServerSettings } from "./server-settings";
import { ServersProvider } from "./servers-context";

let mock: MockOpenBotControls | undefined;

afterEach(() => {
  mock?.dispose();
  mock = undefined;
});

type ServerSettingsStore = ReturnType<typeof useServerSettings>;

/** Mounts the store the MCP panel reads and answers with it, so a test can drive it directly. */
function mountServerSettings(): Promise<ServerSettingsStore> {
  const captured: ServerSettingsStore[] = [];
  function Probe() {
    captured.push(useServerSettings());
    return null;
  }
  render(() => (
    <ServersProvider>
      <ServerSettingsProvider>
        <Probe />
      </ServerSettingsProvider>
    </ServersProvider>
  ));
  return waitFor(() => {
    const store = captured.at(0);
    if (!store) throw new Error("The server settings store did not mount.");
    return store;
  });
}

function mcpState(entries: McpServerEntry[], name: string): string {
  return entries.find((entry) => entry.config.name === name)?.state ?? "missing";
}

describe("server settings MCP states", () => {
  it("keeps a state that settles while a save reply is in flight", async () => {
    mock = createMockOpenBot();
    // The reply is built before it is sent, so this save answers the older snapshot it already
    // holds while the settled state overtakes it. Without the fix the row reads `connecting` for
    // as long as the panel stays open, because a settled server publishes nothing more.
    const save: typeof mock.api.agent.saveMcpServer = async (input, serverId) => {
      const entries = await mock?.api.agent.saveMcpServer(input, serverId);
      if (!entries) throw new Error("The save did not answer.");
      mock?.emitAgentEvent({
        type: "mcp-servers-changed",
        statuses: entries.map((entry) => ({
          id: entry.config.id,
          state: "failed" as const,
          toolCount: 0,
          error: "Command not found: openbot-no-such-command",
        })),
      });
      return entries;
    };
    window.openbot = { ...mock.api, agent: { ...mock.api.agent, saveMcpServer: save } };

    const store = await mountServerSettings();
    store.openServerSettings("local", null);
    await waitFor(() => expect(store.serverSettingsTarget()?.id).toBe("local"));
    await store.watchMcpServers(true);

    await store.saveMcpServer({
      id: "",
      name: "Broken",
      transport: "stdio",
      enabled: true,
      command: "openbot-no-such-command",
      args: [],
      env: [],
      envPassthrough: [],
      workingDirectory: "",
      url: "",
      headers: [],
    });

    expect(mcpState(store.serverSettingsMcp(), "Broken")).toBe("failed");
  });
});
