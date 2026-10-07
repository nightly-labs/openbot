import { CHANNEL_ROUTES } from "@openbot/contracts/team-protocol/channels-v1";
import { RemoteTeamDirectoryClient } from "@openbot/team-client";
import type { RemoteTeamCommand, RemoteTeamCommandResult } from "@openbot/team-client/remote-peer";
import { act, createRef, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, assert, expect, it, vi } from "vitest";
import { RemoteRequestError } from "@/shared/lib/remote-request-error";
import { RemoteTeamTransport, type RemoteTeamTransportRef } from "./remote-team-transport";

const response = vi.hoisted(() => ({ status: 500 }));
vi.mock("expo-crypto", () => ({ randomUUID: () => "request-one" }));
vi.mock("@/features/auth/context/mobile-session-context", () => ({
  useMobileSession: () => ({ refreshProfile: async () => {} }),
}));
vi.mock("./remote-team-bridge.dom", () => ({
  default: ({
    commands,
    onCommandResult,
  }: {
    commands: RemoteTeamCommand[];
    onCommandResult(result: RemoteTeamCommandResult): Promise<void>;
  }) => {
    useEffect(() => {
      for (const command of commands)
        void onCommandResult({
          commandId: command.id,
          ok: true,
          status: response.status,
          body: { error: "Private host diagnostic" },
        });
    }, [commands, onCommandResult]);
    return null;
  },
}));

const container = document.createElement("div");
document.body.append(container);
let root = createRoot(container);
afterEach(async () => {
  await act(() => root.unmount());
  root = createRoot(container);
});

it.each([401, 403, 500])(
  "preserves HTTP %i for task recovery while keeping the response body private",
  async (status) => {
    response.status = status;
    const ref = createRef<RemoteTeamTransportRef>();
    const directory = new RemoteTeamDirectoryClient({ apiUrl: "https://example.com", token: "test", fetch });
    await act(() =>
      root.render(
        <RemoteTeamTransport
          ref={ref}
          active
          directory={directory}
          onConnectionUpdate={() => {}}
          onTeamEvent={() => {}}
        />,
      ),
    );
    const client = ref.current;
    assert(client);
    const decode = vi.fn((value: unknown) => value);
    let request: Promise<unknown> | undefined;
    await act(() => {
      request = client.request("POST", CHANNEL_ROUTES.command, decode, {});
      void request.catch(() => {});
    });
    assert(request);
    await expect(request).rejects.toBeInstanceOf(RemoteRequestError);
    await expect(request).rejects.toMatchObject({ status });
    await expect(request).rejects.not.toThrow("Private host diagnostic");
    expect(decode).not.toHaveBeenCalled();
  },
);
