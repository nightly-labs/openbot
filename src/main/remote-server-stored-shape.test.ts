// @vitest-environment node

import { LOCAL_SERVER_ID } from "@openbot/contracts/ipc";
import type { DynamicRecord } from "@openbot/contracts/runtime-values";
import { describe, expect, it } from "vitest";
import {
  readStoredRemoteServers,
  type StoredRemoteServer,
  serializeStoredRemoteServers,
} from "./remote-server-stored-shape";

function storedServer(overrides: Partial<StoredRemoteServer> & { id: string }): StoredRemoteServer {
  return {
    name: `Server ${overrides.id}`,
    apiUrl: `https://${overrides.id}.trycloudflare.com/`,
    fingerprint: `fingerprint-${overrides.id}`,
    username: "ada",
    encryptedToken: "dG9rZW4=",
    remoteDesktopAvailable: false,
    role: "member",
    ...overrides,
  };
}

describe("stored direct Tailscale address", () => {
  const direct = "https://studio-mac.tail4b2c1.ts.net";
  const file = (server: StoredRemoteServer | DynamicRecord) => ({
    version: 3,
    activeServerId: "alpha",
    servers: [server],
    hiddenHostIds: [],
  });

  it("reads and writes back the address and the member's choice", () => {
    const server = storedServer({ id: "alpha", transport: "webrtc-v2", directUrl: direct, directDisabled: true });
    const stored = readStoredRemoteServers(file(server));
    expect(stored?.servers[0]).toEqual(server);
    expect(stored && serializeStoredRemoteServers(stored).servers[0]).toEqual(server);
  });

  it("reads an entry without the fields, as a build before them wrote it", () => {
    const server = storedServer({ id: "alpha", transport: "webrtc-v2" });
    const stored = readStoredRemoteServers(file(server));
    expect(stored?.servers[0]).toEqual(server);
    expect(stored?.servers[0]).not.toHaveProperty("directUrl");
    expect(stored?.servers[0]).not.toHaveProperty("directDisabled");
  });

  // A build before these fields reads an entry that has them the way this build reads a field it does
  // not know: it keeps the server and drops the field on its next write.
  it("keeps the server when an entry carries a field this build does not know", () => {
    const server = storedServer({ id: "alpha", transport: "webrtc-v2" });
    const stored = readStoredRemoteServers(file({ ...server, directRelayFromTheFuture: { url: "x" } }));
    expect(stored?.servers).toEqual([server]);
    expect(stored?.unreadableServers).toEqual([]);
  });

  it("drops only a bad address or choice, never the server", () => {
    for (const directUrl of [
      "https://example.com",
      "http://studio-mac.tail4b2c1.ts.net",
      "https://studio-mac.tail4b2c1.ts.net/path",
      42,
    ]) {
      const server = storedServer({ id: "alpha", transport: "webrtc-v2" });
      const stored = readStoredRemoteServers(file({ ...server, directUrl, directDisabled: "yes" }));
      expect(stored?.servers).toEqual([server]);
    }
  });
});

describe("stored remote servers", () => {
  // What the store does with an unreadable entry once it is on disk is `remote-server-store.test.ts`.
  // This is the half only the reader decides: which server the app runs on when it cannot read the
  // one the user was on.
  it("runs on the local server when the active one cannot be read, without forgetting which it was", () => {
    const stored = readStoredRemoteServers({
      version: 3,
      activeServerId: "corrupt",
      servers: [{ id: "corrupt", role: "member" }, storedServer({ id: "alpha" })],
      hiddenHostIds: [],
    });

    expect(stored?.activeServerId).toBe(LOCAL_SERVER_ID);
    expect(stored?.servers.map((server) => server.id)).toEqual(["alpha"]);
    expect(stored?.unreadableActiveServerId).toBe("corrupt");
  });

  it("forgets an active id that named no entry at all", () => {
    const stored = readStoredRemoteServers({
      version: 3,
      activeServerId: "gone",
      servers: [storedServer({ id: "alpha" })],
      hiddenHostIds: [],
    });

    expect(stored?.activeServerId).toBe(LOCAL_SERVER_ID);
    expect(stored?.unreadableActiveServerId).toBeNull();
  });

  it("upgrades a version 1 or version 2 file without losing servers", () => {
    for (const version of [1, 2]) {
      const stored = readStoredRemoteServers({
        version,
        activeServerId: "alpha",
        servers: [storedServer({ id: "alpha" })],
      });

      expect(stored).toMatchObject({ version: 3, activeServerId: "alpha", hiddenHostIds: [] });
      expect(stored?.servers).toHaveLength(1);
    }
  });

  it("keeps unreadable entries in the order they arrived, whatever they call themselves", () => {
    // Neither of these names a successor -- both were last -- and neither names itself in a way this
    // build read. An entry it could not read must not get to say where another one lands, or a field
    // it rejected decides the sidebar order of the build that can display them.
    const first = { id: null, name: "first", role: "overlord" };
    const second = { name: "second", role: "overlord" };
    const stored = readStoredRemoteServers({
      version: 3,
      activeServerId: LOCAL_SERVER_ID,
      servers: [storedServer({ id: "alpha" }), first, second],
      hiddenHostIds: [],
    });

    expect(stored && serializeStoredRemoteServers(stored).servers).toEqual([
      expect.objectContaining({ id: "alpha" }),
      first,
      second,
    ]);
  });

  it("refuses a file written by a newer build", () => {
    expect(
      readStoredRemoteServers({
        version: 4,
        activeServerId: LOCAL_SERVER_ID,
        servers: [storedServer({ id: "alpha" })],
        hiddenHostIds: [],
      }),
    ).toBeNull();
  });

  it("round-trips the optional fields a host only sometimes has", () => {
    const stored = readStoredRemoteServers({
      version: 3,
      activeServerId: "host",
      servers: [
        storedServer({
          id: "host",
          publicKey: "cHVibGlj",
          logoVersion: null,
          transport: "webrtc-v2",
          remoteDesktopAvailable: true,
        }),
        storedServer({ id: "tunnel", logoVersion: "v7" }),
      ],
      hiddenHostIds: ["hidden-host", 7],
    });

    expect(stored?.servers[0]).toMatchObject({
      publicKey: "cHVibGlj",
      logoVersion: null,
      transport: "webrtc-v2",
      remoteDesktopAvailable: true,
    });
    expect(stored?.servers[1]).toMatchObject({ logoVersion: "v7", remoteDesktopAvailable: false });
    expect(stored?.servers[1]).not.toHaveProperty("transport");
    expect(stored?.hiddenHostIds).toEqual(["hidden-host"]);
  });
});
