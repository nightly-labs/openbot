import { mkdtemp, rm } from "node:fs/promises";
import { connect, createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger, type Logger } from "@openbot/logging";
import { afterEach, describe, expect, it } from "vitest";
import { CuaDriverActionTap, readRequest } from "./cua-driver-action-tap";
import { STRUCTURED_TEXT_LABEL } from "./cua-driver-structured-text";

/** A stand-in daemon that records what reaches it and answers whatever the test tells it to. */
function fakeDaemon(address: string, answer: string | ((request: string) => string)) {
  const received: string[] = [];
  const sockets: Socket[] = [];
  const server = createServer((socket) => {
    sockets.push(socket);
    socket.on("data", (chunk: Buffer) => {
      const request = chunk.toString("utf8");
      received.push(request);
      socket.write(typeof answer === "string" ? answer : answer(request));
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

/** One whole answer line, which a long answer delivers over many chunks. */
function nextLine(socket: Socket): Promise<string> {
  return new Promise((resolve) => {
    let text = "";
    const read = (chunk: Buffer) => {
      text += chunk.toString("utf8");
      const newline = text.indexOf("\n");
      if (newline < 0) return;
      socket.off("data", read);
      resolve(text.slice(0, newline));
    };
    socket.on("data", read);
  });
}

/** The JSON below the label of the copy the tap adds. */
function copiedJson(text: string): DynamicRecord {
  expect(text.startsWith(`${STRUCTURED_TEXT_LABEL}\n`)).toBe(true);
  const copy = JSON.parse(text.slice(STRUCTURED_TEXT_LABEL.length + 1));
  if (!isDynamicRecord(copy)) throw new Error("The copy is not a JSON object.");
  return copy;
}

describe("CuaDriverActionTap", () => {
  const cleanUp: Array<() => Promise<unknown>> = [];

  afterEach(async () => {
    for (const close of cleanUp.splice(0).reverse()) await close().catch(() => undefined);
  });

  async function taps(
    now: () => number = () => 1_000,
    answer: string | ((request: string) => string) = '{"ok":true}\n',
    logger?: Logger,
  ) {
    // The short system temporary directory, because a Unix socket path has a hard length limit and
    // the test's own working directory is deep.
    const directory = await mkdtemp(join(tmpdir(), "tap-"));
    cleanUp.push(() => rm(directory, { recursive: true, force: true }));
    const upstream = join(directory, "d.sock");
    const address = join(directory, "t.sock");
    const daemon = fakeDaemon(upstream, answer);
    await daemon.listen();
    cleanUp.push(daemon.close);
    const tap = new CuaDriverActionTap(now, logger);
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

  it("logs how long a call took with the tool name, and never what the agent typed", async () => {
    const lines: string[] = [];
    const times = [1_000, 7_500];
    const { client } = await taps(
      () => times.shift() ?? 7_500,
      '{"ok":true}\n',
      createOpenBotLogger("tap", (line) => lines.push(line), "debug"),
    );

    client.write('{"method":"call","name":"type_text","args":{"pid":41,"text":"hunter2-secret"}}\n');
    await nextChunk(client);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("INFO");
    expect(lines[0]).toContain('"tool":"type_text"');
    expect(lines[0]).toContain('"ms":6500');
    expect(lines[0]).not.toContain("hunter2-secret");
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

  it("adds a JSON copy of a tool call's structured result to its text and changes nothing else", async () => {
    // Long enough to cross many socket chunks, which is how a real screenshot arrives.
    const screenshot = "iVBORw0KGgo".padEnd(300_000, "A");
    const windowList = {
      content: [{ type: "text", text: "Found 1 window(s)." }],
      isError: false,
      structuredContent: {
        windows: [
          { window_id: 7, pid: 22, title: "Inbox", bounds: { x: 0, y: 0, width: 800, height: 600 }, z_index: 0 },
        ],
      },
    };
    const windowState = {
      content: [
        { type: "image", data: screenshot, mimeType: "image/png" },
        { type: "text", text: 'window_id=7 pid=22 size=800x600 elements=1\n\n- [0] AXButton "Send"' },
      ],
      isError: false,
      structuredContent: {
        _note: "Prefer `elements`.",
        elements: [{ element_index: 0, role: "AXButton", depth: 1, element_token: "s0000002a:0", label: "Send" }],
        pid: 22,
        screenshot_height: 600,
        screenshot_width: 800,
        snapshot_id: "s0000002a",
        tree_markdown: '- [0] AXButton "Send"',
        window_id: 7,
      },
    };
    const { client } = await taps(
      () => 1_000,
      (request) => {
        const result = JSON.parse(request).name === "list_windows" ? windowList : windowState;
        return `${JSON.stringify({ ok: true, result })}\n`;
      },
    );

    client.write('{"method":"call","name":"list_windows","args":{}}\n');
    const listed = JSON.parse(await nextLine(client)).result;
    client.write('{"method":"call","name":"get_window_state","args":{"pid":22,"window_id":7}}\n');
    const state = JSON.parse(await nextLine(client)).result;

    expect(listed.structuredContent).toEqual(windowList.structuredContent);
    expect(listed.content).toHaveLength(2);
    expect(listed.content[0]).toEqual(windowList.content[0]);
    expect(copiedJson(listed.content[1].text)).toEqual(windowList.structuredContent);

    expect(state.structuredContent).toEqual(windowState.structuredContent);
    expect(state.content).toHaveLength(3);
    expect(state.content.slice(0, 2)).toEqual(windowState.content);
    expect(copiedJson(state.content[2].text)).toEqual({
      pid: 22,
      screenshot_height: 600,
      screenshot_width: 800,
      snapshot_id: "s0000002a",
      tree_markdown: '- [0] AXButton "Send"',
      window_id: 7,
      element_address:
        "To act on an element, send this snapshot_id with the element_index that the tree in the result text shows.",
    });
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
