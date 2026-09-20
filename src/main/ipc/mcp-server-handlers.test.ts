// @vitest-environment node

// The local connection test starts the managed runtime download only when the command needs it,
// and a failed download still reaches the probe. The handlers register through the trusted binder,
// so Electron is mocked and the registration captured instead of performed.

import {
  decodeMcpTestResult,
  IPC_CHANNELS,
  LOCAL_SERVER_ID,
  type McpServerConfig,
  type McpTestResult,
} from "@openbot/contracts/ipc";
import { describe, expect, it, vi } from "vitest";
import { NO_MCP_TOOL_RUNTIMES } from "../../backend/mcp-provider-shapes";
import { registerIpcGroup } from "./define-ipc-group";
import { mcpServerIpcHandlers } from "./mcp-server-handlers";

const { registrations } = vi.hoisted(() => ({
  registrations: new Map<string, (event: unknown, ...arguments_: unknown[]) => unknown>(),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle(channel: string, listener: (event: unknown, ...arguments_: unknown[]) => unknown) {
      registrations.set(channel, listener);
    },
  },
}));

const TRUSTED_EVENT = { senderFrame: { url: "openbot-app://app/index.html" } };

function stdioConfig(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id: "",
    name: "Tool",
    transport: "stdio",
    enabled: true,
    command: "openbot-no-such-command",
    args: [],
    env: [],
    envPassthrough: [],
    workingDirectory: "",
    url: "",
    headers: [],
    ...overrides,
  };
}

function httpConfig(): McpServerConfig {
  return {
    id: "",
    name: "Signed in",
    transport: "http",
    enabled: true,
    command: "",
    args: [],
    env: [],
    envPassthrough: [],
    workingDirectory: "",
    url: "https://mcp.example.com/mcp",
    headers: [],
  };
}

function setup(options: { ensureToolRuntimesReady?: () => Promise<void> }): {
  ensureToolRuntimesReady: ReturnType<typeof vi.fn>;
  testMcpServer: ReturnType<typeof vi.fn>;
  test: (config: McpServerConfig) => Promise<McpTestResult>;
} {
  registrations.clear();
  const testMcpServer = vi.fn(async (): Promise<McpTestResult> => ({ toolCount: 2, error: null }));
  const service = {
    listMcpServers: () => [],
    saveMcpServer: (input: { config: McpServerConfig }) => [input.config],
    removeMcpServer: () => [],
    setMcpServerEnabled: () => [],
    testMcpServer,
  };
  const remoteServers = {
    supportsCapability: () => true,
    request: vi.fn(),
  };
  const ensureToolRuntimesReady = vi.fn(options.ensureToolRuntimesReady ?? (async () => undefined));
  registerIpcGroup(
    "mcpServers",
    mcpServerIpcHandlers({
      service,
      remoteServers,
      startToolRuntimes: () => undefined,
      ensureToolRuntimesReady,
      toolRuntimes: () => NO_MCP_TOOL_RUNTIMES,
    }).mcpServers,
  );
  const listener = registrations.get(IPC_CHANNELS.serversTestMcpServer);
  if (!listener) throw new Error("The MCP test handler was not registered.");
  return {
    ensureToolRuntimesReady,
    testMcpServer,
    // Decoded with the production codec, so the test reads what the renderer would.
    test: (config) =>
      Promise.resolve(listener(TRUSTED_EVENT, { serverId: LOCAL_SERVER_ID, payload: { config } })).then(
        decodeMcpTestResult,
      ),
  };
}

describe("mcpServerIpcHandlers test", () => {
  it("probes an installed command without waiting for the download", async () => {
    const { ensureToolRuntimesReady, testMcpServer, test } = setup({});

    // An absolute path is taken as written: no lookup runs, so no download is waited for.
    await expect(test(stdioConfig({ command: "/bin/echo", args: ["ready"] }))).resolves.toEqual({
      toolCount: 2,
      error: null,
    });
    expect(ensureToolRuntimesReady).not.toHaveBeenCalled();
    expect(testMcpServer).toHaveBeenCalledOnce();
  });

  it("never waits for the download for an http server", async () => {
    const { ensureToolRuntimesReady, testMcpServer, test } = setup({});

    await expect(test(httpConfig())).resolves.toEqual({ toolCount: 2, error: null });
    expect(ensureToolRuntimesReady).not.toHaveBeenCalled();
    expect(testMcpServer).toHaveBeenCalledOnce();
  });

  it("waits for the download before probing a command nothing names", async () => {
    const { ensureToolRuntimesReady, testMcpServer, test } = setup({});

    await expect(test(stdioConfig())).resolves.toEqual({ toolCount: 2, error: null });
    expect(ensureToolRuntimesReady).toHaveBeenCalledOnce();
    expect(testMcpServer).toHaveBeenCalledOnce();
    expect(ensureToolRuntimesReady.mock.invocationCallOrder[0]).toBeLessThan(
      testMcpServer.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  it("still probes when the download fails", async () => {
    // A runtime the download cannot provide - and a transfer that fails halfway - is not the
    // test's failure: the probe still runs and reports what this machine starts.
    const { testMcpServer, test } = setup({
      ensureToolRuntimesReady: async () => {
        throw new Error("The runtime download failed.");
      },
    });

    await expect(test(stdioConfig())).resolves.toEqual({ toolCount: 2, error: null });
    expect(testMcpServer).toHaveBeenCalledOnce();
  });
});
