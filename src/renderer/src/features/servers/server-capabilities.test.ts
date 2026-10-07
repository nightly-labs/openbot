import type { ServerSummary } from "@openbot/contracts/ipc";
import { AGENT_WORKING_DIRECTORY_CAPABILITY } from "@openbot/contracts/team-protocol/agent-working-directory-v1";
import { describe, expect, it } from "vitest";
import { serverSupportsCapability } from "./server-capabilities";

const remoteServer = (capabilities?: string[]): ServerSummary => ({
  notificationsMuted: false,
  notificationsMutedUntil: null,
  notificationLevel: "all",
  id: "remote-1",
  name: "Remote",
  kind: "remote",
  state: "online",
  apiUrl: "https://remote.example",
  remoteDesktopAvailable: false,
  logoUrl: null,
  role: "admin",
  active: true,
  compatibility:
    capabilities === undefined
      ? undefined
      : {
          localAppVersion: "1.0.0",
          hostAppVersion: "1.0.0",
          localProtocol: { minimum: 1, maximum: 1 },
          hostProtocol: { minimum: 1, maximum: 1 },
          negotiatedProtocol: 1,
          capabilities,
        },
});

describe("serverSupportsCapability", () => {
  it("requires an explicit capability from remote servers", () => {
    expect(serverSupportsCapability(remoteServer(), AGENT_WORKING_DIRECTORY_CAPABILITY)).toBe(false);
    expect(serverSupportsCapability(remoteServer(["agent-admin-v1"]), AGENT_WORKING_DIRECTORY_CAPABILITY)).toBe(false);
    expect(
      serverSupportsCapability(remoteServer([AGENT_WORKING_DIRECTORY_CAPABILITY]), AGENT_WORKING_DIRECTORY_CAPABILITY),
    ).toBe(true);
  });
});
