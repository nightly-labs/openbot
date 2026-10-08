import { Effect } from "effect";
// @vitest-environment node

// The local connection test starts the managed runtime download only when the command needs it,
// and a failed download still reaches the probe. The handlers register through the trusted binder,
// so Electron is mocked and the registration captured instead of performed.

import {
  decodeMcpTestResult,
  IPC_ENDPOINTS,
  LOCAL_SERVER_ID,
  type McpServerConfig,
  type McpTestResult,
} from "@openbot/contracts/ipc";
import { describe, expect, it, vi } from "vitest";
import { NO_MCP_TOOL_RUNTIMES } from "../../backend/mcp-provider-shapes";
import { ProviderRuntimeFailure } from "../provider-runtime-effects";
import type { ResponseDecoder } from "../remote-host-decoding";
import type { RemoteRequestInit } from "../remote-server-client";
import { REMOTE_REQUEST_TIMEOUT_MS } from "../remote-server-http";
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

function setup(options: { ensureToolRuntimesReady?: () => Effect.Effect<void, ProviderRuntimeFailure> }): {
  ensureToolRuntimesReady: ReturnType<typeof vi.fn>;
  testMcpServer: ReturnType<typeof vi.fn>;
  remoteCalls: RemoteRequestInit[];
  test: (config: McpServerConfig) => Promise<McpTestResult>;
  testRemote: (config: McpServerConfig) => Promise<McpTestResult>;
  signInRemote: (config: McpServerConfig) => Promise<unknown>;
} {
  registrations.clear();
  const testMcpServer = vi.fn((): Effect.Effect<McpTestResult> => Effect.sync(() => ({ toolCount: 2, error: null })));
  const service = {
    listMcpServers: () => [],
    saveMcpServer: (input: { config: McpServerConfig }) => Effect.succeed([input.config]),
    removeMcpServer: () => Effect.succeed([]),
    setMcpServerEnabled: () => Effect.succeed([]),
    testMcpServer,
    signInMcpServer: () => Effect.succeed({ toolCount: 0, error: null }),
    cancelMcpSignIn: () => undefined,
    signOutMcpServer: () => Effect.succeed([]),
    listMcpSignIns: () => [],
  };
  const remoteCalls: RemoteRequestInit[] = [];
  const remoteServers = {
    supportsCapability: () => true,
    // Generic like the manager: the host answers what the codec below decodes.
    request: <T>(
      _serverId: string,
      _path: string,
      decoder: ResponseDecoder<T>,
      init?: RemoteRequestInit,
    ): Effect.Effect<T> =>
      Effect.sync(() => {
        if (init) remoteCalls.push(init);
        return decoder({ toolCount: 1, error: null });
      }),
  };
  const ensureToolRuntimesReady = vi.fn(options.ensureToolRuntimesReady ?? (() => Effect.sync(() => undefined)));
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
  const listener = registrations.get(IPC_ENDPOINTS.mcpServers.testMcpServer.channel);
  const signInListener = registrations.get(IPC_ENDPOINTS.mcpServers.signInMcpServer.channel);
  if (!listener || !signInListener) throw new Error("The MCP test handlers were not registered.");
  return {
    signInRemote: async (config) => signInListener(TRUSTED_EVENT, { serverId: "remote-1", payload: { config } }),
    ensureToolRuntimesReady,
    testMcpServer,
    remoteCalls,
    // Decoded with the production codec, so the test reads what the renderer would.
    test: (config) =>
      Promise.resolve(listener(TRUSTED_EVENT, { serverId: LOCAL_SERVER_ID, payload: { config } })).then(
        decodeMcpTestResult,
      ),
    testRemote: (config) =>
      Promise.resolve(listener(TRUSTED_EVENT, { serverId: "remote-1", payload: { config } })).then(decodeMcpTestResult),
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
    // Test spends the stored sign-in and never opens a browser; only Sign in does.
    expect(testMcpServer).toHaveBeenCalledWith(expect.anything(), { storedCredentials: true, signInPlace: "here" });
  });

  it("refuses a sign-in for a remote server without asking the host", async () => {
    // Nobody sits in front of the host's browser, and the Team API has no sign-in route.
    const { remoteCalls, signInRemote } = setup({});

    await expect(signInRemote(httpConfig())).rejects.toThrow(
      "Sign-in to an MCP server works only in OpenBot on the host computer.",
    );
    expect(remoteCalls).toHaveLength(0);
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
      ensureToolRuntimesReady: () =>
        Effect.fail(new ProviderRuntimeFailure({ cause: new Error("The runtime download failed.") })),
    });

    await expect(test(stdioConfig())).resolves.toEqual({ toolCount: 2, error: null });
    expect(testMcpServer).toHaveBeenCalledOnce();
  });

  it("gives a remote test a deadline that covers the host preparation", async () => {
    // The host may wait out the runtime download before its own probe deadline even starts.
    // The default request limit would report a timeout for a download that is still running,
    // before the host probes anything.
    const { ensureToolRuntimesReady, testMcpServer, remoteCalls, testRemote } = setup({});

    await expect(testRemote(stdioConfig())).resolves.toEqual({ toolCount: 1, error: null });
    expect(ensureToolRuntimesReady).not.toHaveBeenCalled();
    expect(testMcpServer).not.toHaveBeenCalled();
    expect(remoteCalls).toHaveLength(1);
    expect(remoteCalls[0]?.timeoutMs).toBeGreaterThan(REMOTE_REQUEST_TIMEOUT_MS);
  });
});
