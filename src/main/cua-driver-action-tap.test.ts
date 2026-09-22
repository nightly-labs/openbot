import { mkdtemp, rm } from "node:fs/promises";
import { connect, createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CuaDriverActionTap, readRequest } from "./cua-driver-action-tap";

/** A stand-in daemon that records what reaches it and answers whatever the test tells it to. */
function fakeDaemon(address: string, answer: string) {
  const received: string[] = [];
  const sockets: Socket[] = [];
  const server = createServer((socket) => {
    sockets.push(socket);
    socket.on("data", (chunk: Buffer) => {
      received.push(chunk.toString("utf8"));
      socket.write(answer);
    });
    socket.on("error", () => undefined);
  });
  return {
    received,
    listen: () =>
      new Promise<Server>((resolve) => {
        server.listen(address, () => resolve(server));
      }),
    close: () => {
      for (const socket of sockets) socket.destroy();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function nextChunk(socket: Socket): Promise<string> {
  return new Promise((resolve) => socket.once("data", (chunk: Buffer) => resolve(chunk.toString("utf8"))));
}

describe("CuaDriverActionTap", () => {
  const cleanUp: Array<() => Promise<unknown>> = [];

  afterEach(async () => {
    for (const close of cleanUp.splice(0).reverse()) await close().catch(() => undefined);
  });

  async function taps(now: () => number = () => 1_000) {
    // The short system temporary directory, because a Unix socket path has a hard length limit and
    // the test's own working directory is deep.
    const directory = await mkdtemp(join(tmpdir(), "tap-"));
    cleanUp.push(() => rm(directory, { recursive: true, force: true }));
    const upstream = join(directory, "d.sock");
    const address = join(directory, "t.sock");
    const daemon = fakeDaemon(upstream, '{"ok":true}\n');
    await daemon.listen();
    cleanUp.push(daemon.close);
    const tap = new CuaDriverActionTap(now);
    await tap.listen({ upstream, tap: address });
    cleanUp.push(() => tap.close());
    const client = connect(address);
    cleanUp.push(async () => client.destroy());
    return { tap, daemon, client };
  }

  it("forwards a request to the daemon and its answer back, byte for byte", async () => {
    const { daemon, client } = await taps();
    const request = '{"method":"call","name":"click","args":{"pid":22,"x":10,"y":20}}\n';

    client.write(request);
    const answer = await nextChunk(client);

    expect(daemon.received.join("")).toBe(request);
    expect(answer).toBe('{"ok":true}\n');
  });

  it("reports the application and window the agent asked the daemon to act on", async () => {
    const { tap, client } = await taps();

    client.write('{"method":"session_begin","session_id":"mcp-1"}\n');
    client.write('{"method":"call","name":"click","args":{"pid":22,"window_id":7}}\n');
    await nextChunk(client);

    expect(tap.lastAction(60_000)).toEqual({ tool: "click", pid: 22, windowId: 7, at: 1_000 });
  });

  it("reads a request that arrives in pieces, which a long argument does", async () => {
    const { tap, client } = await taps();

    client.write('{"method":"call","name":"type_text","args":{"pid"');
    client.write(':41,"text":"half a line"}}\n');
    await nextChunk(client);

    expect(tap.lastAction(60_000)?.pid).toBe(41);
  });

  it("reports the point the agent aimed at, apart from the window it named", async () => {
    const { tap, client } = await taps();

    client.write('{"method":"call","name":"click","args":{"pid":22,"window_id":7,"x":600,"y":500}}\n');
    // A read names a window and no point; it must not take the point away from the click above.
    client.write('{"method":"call","name":"get_window_state","args":{"pid":22,"window_id":7}}\n');
    await nextChunk(client);

    expect(tap.lastPointer(60_000)).toEqual({ tool: "click", x: 600, y: 500, at: 1_000 });
    expect(tap.lastAction(60_000)?.tool).toBe("get_window_state");
  });

  it("lets go of an answer that is older than the work it describes", async () => {
    let now = 1_000;
    const { tap, client } = await taps(() => now);

    client.write('{"method":"call","name":"click","args":{"pid":22}}\n');
    await nextChunk(client);
    now = 1_000 + 60_001;

    expect(tap.lastAction(60_000)).toBeNull();
  });
});

describe("readRequest", () => {
  it("takes the target out of a tool call, whether it is named directly or inside a target", () => {
    expect(readRequest('{"method":"call","name":"click","args":{"pid":3,"window_id":9}}', 5).action).toEqual({
      tool: "click",
      pid: 3,
      windowId: 9,
      at: 5,
    });
    expect(
      readRequest('{"method":"call","name":"zoom","args":{"target":{"kind":"window","pid":3,"window_id":9}}}', 5)
        .action,
    ).toEqual({ tool: "zoom", pid: 3, windowId: 9, at: 5 });
  });

  it("reports nothing rather than a guess for a request that names no target", () => {
    expect(readRequest('{"method":"list"}', 5).action).toBeNull();
    expect(readRequest('{"method":"call","name":"list_windows","args":{}}', 5).action).toBeNull();
    expect(readRequest('{"method":"call","name":"click","args":{"pid":"22"}}', 5).action).toBeNull();
    expect(readRequest("not json", 5).action).toBeNull();
  });

  it("takes the point out of the tools that aim the pointer, and out of no other", () => {
    expect(readRequest('{"method":"call","name":"move_cursor","args":{"x":600,"y":500}}', 5).pointer).toEqual({
      tool: "move_cursor",
      x: 600,
      y: 500,
      at: 5,
    });
    // `set_window_frame` moves a window to a point and leaves the pointer where it is, so a cursor
    // drawn on it would walk away from the work.
    expect(
      readRequest('{"method":"call","name":"set_window_frame","args":{"pid":3,"x":0,"y":0}}', 5).pointer,
    ).toBeNull();
    // A click on a snapshot element names the element and no point at all.
    expect(readRequest('{"method":"call","name":"click","args":{"pid":3,"element_token":"e1"}}', 5).pointer).toBeNull();
  });
});
