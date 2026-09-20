import type { McpServerConfig, TestMcpServerInput } from "@openbot/contracts/ipc";
import { render, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { createMockOpenBot, type MockOpenBotControls } from "../../preview/mock-openbot";
import { takeMcpConfigDoorNotice } from "./mcp-servers";
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

  // Nothing waits for this promise - the modal asks for the list when its MCP section appears - so
  // an unreported failure would leave the panel saying the server holds no MCP servers at all.
  it("reports a failed list read instead of showing an empty list", async () => {
    mock = createMockOpenBot();
    let failing = true;
    const list: typeof mock.api.agent.listMcpServers = async (serverId) => {
      if (failing) throw new Error("The host is not reachable.");
      const answer = await mock?.api.agent.listMcpServers(serverId);
      if (!answer) throw new Error("The list did not answer.");
      return answer;
    };
    window.openbot = { ...mock.api, agent: { ...mock.api.agent, listMcpServers: list } };

    const store = await openLocalSettings();
    await store.refreshMcpServers();
    expect(store.serverSettingsMcpError()).toBe("The host is not reachable.");
    expect(store.serverSettingsMcp()).toEqual([]);

    failing = false;
    await store.refreshMcpServers();
    expect(store.serverSettingsMcpError()).toBeNull();
    expect(store.serverSettingsMcp().length).toBeGreaterThan(0);
  });

  // The two loads start from different events, so one counter would let either one discard the
  // other's reply: the MCP list would stay empty with no second request to fill it.
  it("keeps the MCP list when a settings refresh runs beside it", async () => {
    mock = createMockOpenBot();
    window.openbot = mock.api;

    const store = await openLocalSettings();
    const mcp = store.refreshMcpServers();
    await store.refreshServerSettings("local");
    await mcp;

    expect(store.serverSettingsMcp().length).toBeGreaterThan(0);
    expect(store.serverSettingsLoading()).toBe(false);
  });

  // The user can leave the MCP section and come back, which starts a read while the rows on screen
  // are still actionable. A removal that answers first must not be undone by that read.
  it("keeps a removed server out when an earlier list read answers late", async () => {
    mock = createMockOpenBot();
    let gate: Promise<void> | null = null;
    const list: typeof mock.api.agent.listMcpServers = async (serverId) => {
      // The list is read before the wait, so this answers with the servers as they were then.
      const answer = await mock?.api.agent.listMcpServers(serverId);
      if (!answer) throw new Error("The list did not answer.");
      if (gate) await gate;
      return answer;
    };
    window.openbot = { ...mock.api, agent: { ...mock.api.agent, listMcpServers: list } };

    const store = await openLocalSettings();
    await store.refreshMcpServers();
    const removed = store.serverSettingsMcp().at(0);
    if (!removed) throw new Error("The mock server has no MCP servers to remove.");

    let open = (): void => undefined;
    gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const late = store.refreshMcpServers();
    await store.removeMcpServer(removed.id);
    open();
    await late;

    expect(store.serverSettingsMcp().some((config) => config.id === removed.id)).toBe(false);
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

/*
 * The notice for the release that takes servers away. It is owed to a user who declared an MCP
 * server outside OpenBot and is about to lose it, and to nobody else - so the flag has to be kept
 * whichever way the question is answered.
 */
describe("the MCP configuration notice", () => {
  /** A storage this test owns, so the flag of one case cannot answer another. */
  function fakeStorage() {
    const values = new Map<string, string>();
    return {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };
  }

  it("names the files it takes servers from, once", () => {
    const storage = fakeStorage();

    const notice = takeMcpConfigDoorNotice(true, storage);

    expect(notice?.description).toContain("~/.claude/settings.json");
    expect(notice?.description).toContain("~/.codex/config.toml");
    expect(takeMcpConfigDoorNotice(true, storage)).toBeNull();
  });

  it("stays silent for a user who is still in onboarding, and afterwards", () => {
    const storage = fakeStorage();

    expect(takeMcpConfigDoorNotice(false, storage)).toBeNull();
    // Onboarding finishes in the same session. This user never had a server in another file, so
    // the notice would describe a loss that cannot happen to them.
    expect(takeMcpConfigDoorNotice(true, storage)).toBeNull();
  });
});
