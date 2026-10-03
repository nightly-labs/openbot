import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import { createHostedMobileConnect } from "./mobile-connect-host";

const binding = { hostId: "host-a", fingerprint: "a".repeat(43) };

describe("createHostedMobileConnect", () => {
  it("creates and starts a local server before issuing the pairing code", async () => {
    const operations: string[] = [];
    const ticket = { qrData: "openbot://mobile-connect?ticket=test", expiresAt: Date.now() + 60_000 };

    await expect(
      Effect.runPromise(
        createHostedMobileConnect({
          centralAuth: {
            createMobileConnect: (host) =>
              Effect.sync(() => {
                expect(host).toEqual(binding);
                operations.push("ticket");
                return ticket;
              }),
          },
          host: {
            getMobileConnectHost: () => binding,
            getStatus: () => ({ configured: false }),
            configure: () =>
              Effect.sync(() => {
                operations.push("configure");
                return { configured: true };
              }),
            start: () =>
              Effect.sync(() => {
                operations.push("start");
                return {
                  serverId: binding.hostId,
                  apiOnline: true,
                  apiUrl: "wss://signal.openbot.run/v1/signal",
                  message: null,
                  phase: "online" as const,
                };
              }),
          },
        }).pipe(Effect.mapError((error) => error.cause)),
      ),
    ).resolves.toEqual(ticket);
    expect(operations).toEqual(["configure", "start", "ticket"]);
  });

  it("preserves the existing server identity", async () => {
    const operations: string[] = [];

    await Effect.runPromise(
      createHostedMobileConnect({
        centralAuth: {
          createMobileConnect: () =>
            Effect.sync(() => {
              operations.push("ticket");
              return { qrData: "openbot://mobile-connect?ticket=test", expiresAt: Date.now() + 60_000 };
            }),
        },
        host: {
          getMobileConnectHost: () => binding,
          getStatus: () => ({ configured: true }),
          configure: () =>
            Effect.sync(() => {
              operations.push("configure");
              return { configured: true };
            }),
          start: () =>
            Effect.sync(() => {
              operations.push("start");
              return {
                serverId: binding.hostId,
                apiOnline: true,
                apiUrl: "wss://signal.openbot.run/v1/signal",
                message: null,
                phase: "online" as const,
              };
            }),
        },
      }),
    );

    expect(operations).toEqual(["start", "ticket"]);
  });

  it("does not issue a pairing code while only the local development API is online", async () => {
    const createMobileConnect = vi.fn();

    await expect(
      Effect.runPromise(
        createHostedMobileConnect({
          centralAuth: { createMobileConnect },
          host: {
            getMobileConnectHost: () => binding,
            getStatus: () => ({ configured: true }),
            configure: () => Effect.sync(() => ({ configured: true })),
            start: () =>
              Effect.sync(() => ({
                serverId: binding.hostId,
                apiOnline: true,
                apiUrl: "http://localhost:49231",
                message: "Local development host is ready.",
                phase: "online" as const,
              })),
          },
        }).pipe(Effect.mapError((error) => error.cause)),
      ),
    ).rejects.toThrow("Local development host is ready.");
    expect(createMobileConnect).not.toHaveBeenCalled();
  });
});
