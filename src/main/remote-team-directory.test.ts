import { Effect } from "effect";
import { RemoteWorkflowError } from "./remote-service-effects";
// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { runCauseEffect } from "../backend/effect-boundary";
import { RemoteTeamDirectory } from "./remote-team-directory";

function legacyHost() {
  return new RemoteTeamDirectory({
    servers: {
      require: (serverId: string) => ({
        id: serverId,
        name: "Legacy host",
        apiUrl: "https://legacy.example.test",
        fingerprint: "fingerprint",
        publicKey: "public-key",
        username: "owner@example.com",
        encryptedToken: "",
        remoteDesktopAvailable: false,
        logoVersion: null,
        role: "admin" as const,
      }),
    },
    request: vi.fn(() => Effect.fail(new RemoteWorkflowError({ cause: new Error("Must not reach the host.") }))),
    transport: null,
    sendInviteEmail: () => Effect.void,
  });
}

describe("RemoteTeamDirectory", () => {
  it("refuses permanent links on legacy HTTP hosts instead of minting single-use", async () => {
    await expect(
      runCauseEffect(legacyHost().createInvite("server-1", { role: "member", permanent: true })),
    ).rejects.toThrow("does not support permanent invitation links");
  });
});
