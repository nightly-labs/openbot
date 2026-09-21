// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CuaDriverDaemonClient } from "./cua-driver-daemon-client";

/** A daemon that answers one line per line, and remembers what it was asked. */
function fakeDaemon(answer: (request: DynamicRecord) => unknown) {
  const requests: DynamicRecord[] = [];
  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    let pending = "";
    socket.setEncoding("utf8");
    socket.on("error", () => undefined);
    socket.on("data", (chunk: string) => {
      pending += chunk;
      let newline = pending.indexOf("\n");
      while (newline >= 0) {
        const request = JSON.parse(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
        if (!isDynamicRecord(request)) throw new Error("The client sent something that is not a request.");
        requests.push(request);
        socket.write(`${JSON.stringify(answer(request))}\n`);
        newline = pending.indexOf("\n");
      }
    });
  });
  return {
    requests,
    connections: sockets,
    listen: (path: string) => new Promise<void>((resolve) => server.listen(path, resolve)),
    dropConnections: () => {
      for (const socket of sockets) socket.destroy();
      sockets.clear();
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

const windowsResult = {
  content: [{ type: "text", text: "two windows" }],
  structuredContent: { windows: [{ window_id: 7 }] },
};

describe("CuaDriverDaemonClient", () => {
  let directory = "";
  let socketPath = "";
  let daemon: ReturnType<typeof fakeDaemon> | null = null;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "openbot-cua-read-"));
    socketPath = join(directory, "driver.sock");
  });

  afterEach(async () => {
    await daemon?.close();
    daemon = null;
    await rm(directory, { recursive: true, force: true });
  });

  it("reads the windows as the driver's own command line does, on one connection", async () => {
    daemon = fakeDaemon((request) => ({ ok: true, result: request.method === "call" ? windowsResult : { count: 0 } }));
    await daemon.listen(socketPath);
    const client = new CuaDriverDaemonClient(() => socketPath);

    expect(await client.listWindows()).toEqual({ windows: [{ window_id: 7 }] });
    expect(await client.sessions()).toEqual({ count: 0 });
    await client.close();

    // The whole point of this client: the reads the rim makes many times a second cost no process
    // and no second connection.
    expect(daemon.requests.slice(0, 2)).toEqual([
      { method: "call", name: "list_windows", args: {}, session_id: "openbot-highlight", client_kind: "cli" },
      { method: "sessions_list", client_kind: "cli" },
    ]);
    // Reported as OpenBot's own, so the rim does not read its own lease as an agent at work.
    expect(daemon.requests.every((request) => request.client_kind === "cli")).toBe(true);
  });

  it("gives the lease back when it is closed", async () => {
    daemon = fakeDaemon(() => ({ ok: true, result: windowsResult }));
    await daemon.listen(socketPath);
    const client = new CuaDriverDaemonClient(() => socketPath);
    await client.listWindows();

    await client.close();

    expect(daemon.requests.at(-1)).toEqual({
      method: "session_end",
      session_id: "openbot-highlight",
      client_kind: "cli",
    });
  });

  it("connects again after the daemon drops the connection", async () => {
    daemon = fakeDaemon(() => ({ ok: true, result: windowsResult }));
    await daemon.listen(socketPath);
    const client = new CuaDriverDaemonClient(() => socketPath);
    await client.listWindows();

    daemon.dropConnections();

    // A daemon that restarts, or a socket the system closes, costs the read that is in the air and
    // nothing after it: the next read opens a connection of its own.
    await expect(client.listWindows()).rejects.toThrow();
    expect(await client.listWindows()).toEqual({ windows: [{ window_id: 7 }] });
    await client.close();
  });

  it("reports what the daemon refused, rather than an answer it did not give", async () => {
    daemon = fakeDaemon(() => ({ ok: false, error: "permissions_pending" }));
    await daemon.listen(socketPath);
    const client = new CuaDriverDaemonClient(() => socketPath);

    await expect(client.listWindows()).rejects.toThrow("permissions_pending");
    await client.close();
  });

  it("says the driver is not running rather than connecting to nothing", async () => {
    const client = new CuaDriverDaemonClient(() => null);

    await expect(client.sessions()).rejects.toThrow("not running");
  });
});
