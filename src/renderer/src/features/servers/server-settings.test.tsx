import type { McpServerConfig, TestMcpServerInput } from "@openbot/contracts/ipc";
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

const DRAFT: McpServerConfig = {
  id: "",
  name: "Draft",
  transport: "stdio",
  enabled: false,
  command: "openbot-no-such-command",
  args: [],
  env: [],
  envPassthrough: [],
  workingDirectory: "",
  url: "",
  headers: [],
};

async function openLocalSettings(): Promise<ServerSettingsStore> {
  const store = await mountServerSettings();
  store.openServerSettings("local", null);
  await waitFor(() => expect(store.serverSettingsTarget()?.id).toBe("local"));
  return store;
}

describe("server settings MCP", () => {
  it("tests a draft without saving it", async () => {
    mock = createMockOpenBot();
    const sent: TestMcpServerInput[] = [];
    const test: typeof mock.api.agent.testMcpServer = async (input, serverId) => {
      sent.push(input);
      const answer = await mock?.api.agent.testMcpServer(input, serverId);
      if (!answer) throw new Error("The test did not answer.");
      return answer;
    };
    window.openbot = { ...mock.api, agent: { ...mock.api.agent, testMcpServer: test } };

    const store = await openLocalSettings();
    await store.refreshMcpServers();
    const before = store.serverSettingsMcp().length;

    // The draft is sent whole, because it has no id to send: a user can ask whether a server
    // answers before keeping it.
    expect(await store.testMcpServer(DRAFT)).toEqual({ toolCount: 4, error: null });
    expect(sent).toEqual([{ config: DRAFT }]);
    expect(store.serverSettingsMcp()).toHaveLength(before);
  });

  it("takes the whole list from a save reply", async () => {
    mock = createMockOpenBot();
    window.openbot = mock.api;

    const store = await openLocalSettings();
    await store.refreshMcpServers();
    await store.saveMcpServer({ ...DRAFT, name: "Kept" });

    expect(store.serverSettingsMcp().map((config) => config.name)).toContain("Kept");
  });
});
