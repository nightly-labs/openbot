import { restartActivityGeneration } from "../backend/restart-activity";
// @vitest-environment node

import { createServer, type IncomingMessage } from "node:http";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { Duplex } from "node:stream";
import { decodeBrowserViewFrame, encodeBrowserViewInput } from "@openbot/contracts/team-protocol/browser-view-v1";
import { afterEach, describe, expect, it, vi } from "vitest";
import type * as Ws from "ws";
import { z } from "zod";
import type { BrowserViewportInput } from "../backend/browser-cdp";
import { BrowserViewGateway } from "./browser-view-gateway";

const requireModule = createRequire(import.meta.url);
const webSockets: typeof Ws = requireModule(join(dirname(requireModule.resolve("ws/package.json")), "index.js"));
const TEAM_SESSION = "team-session-1";
const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

describe("the live browser view on a host", () => {
  it("sends the tab's frames and dispatches a click at the point on the frame", async () => {
    const dispatched: BrowserViewportInput[] = [];
    let send: ((frame: { sequence: number; width: number; height: number; image: Uint8Array }) => void) | undefined;
    const gateway = new BrowserViewGateway({
      browser: {
        startView: async (_tabId, onFrame) => {
          send = onFrame;
          return async () => undefined;
        },
        dispatchViewInput: async (_tabId, input) => {
          dispatched.push(input);
        },
      },
      authenticate: () => null,
    });
    const origin = await serve(gateway);
    const session = gateway.createSession({ memberId: "member-1", teamSessionId: TEAM_SESSION, tabId: "tab-1" });

    const socket = new webSockets.WebSocket(`${origin}${session.streamPath}`, {
      headers: { "X-OpenBot-WebRTC-Session": TEAM_SESSION },
    });
    const frames = collect(socket);
    await new Promise((resolve) => socket.once("open", resolve));
    await vi.waitFor(() => expect(send).toBeDefined());
    send?.({ sequence: 1, width: 1200, height: 800, image: new Uint8Array([0xff, 0xd8, 0xff]) });
    await vi.waitFor(() => expect(frames).toHaveLength(1));
    expect(decodeBrowserViewFrame(frames[0])).toMatchObject({ sequence: 1, width: 1200, height: 800 });

    socket.send(
      encodeBrowserViewInput({
        type: "pointer",
        action: "down",
        x: 0.5,
        y: 0.25,
        button: "left",
        clickCount: 1,
        deltaX: 0,
        deltaY: 0,
        modifiers: 0,
      }),
    );
    // The member's pointer is a fraction of the frame they watched; the host's page is in pixels.
    await vi.waitFor(() => expect(dispatched).toEqual([expect.objectContaining({ x: 600, y: 200 })]));
    socket.close();
    await gateway.stop();
  });

  it("keeps a click on the last frame the member saw when a newer frame is dropped", async () => {
    const dispatched: BrowserViewportInput[] = [];
    let send: ((frame: { sequence: number; width: number; height: number; image: Uint8Array }) => void) | undefined;
    const gateway = new BrowserViewGateway({
      browser: {
        startView: async (_tabId, onFrame) => {
          send = onFrame;
          return async () => undefined;
        },
        dispatchViewInput: async (_tabId, input) => {
          dispatched.push(input);
        },
      },
      authenticate: () => null,
    });
    const origin = await serve(gateway);
    const session = gateway.createSession({ memberId: "member-1", teamSessionId: TEAM_SESSION, tabId: "tab-1" });

    const socket = new webSockets.WebSocket(`${origin}${session.streamPath}`, {
      headers: { "X-OpenBot-WebRTC-Session": TEAM_SESSION },
    });
    const frames = collect(socket);
    await new Promise((resolve) => socket.once("open", resolve));
    await vi.waitFor(() => expect(send).toBeDefined());
    send?.({ sequence: 1, width: 1200, height: 800, image: new Uint8Array([0xff, 0xd8, 0xff]) });
    await vi.waitFor(() => expect(frames).toHaveLength(1));

    // A member who stops reading is the case the drop exists for. These fillers are the shape the
    // member is already watching, so whether each one arrives changes nothing; they are here to put
    // the socket over its buffer.
    socket.pause();
    const filler = new Uint8Array(1_500_000);
    filler.set([0xff, 0xd8, 0xff]);
    for (let sequence = 2; sequence <= 13; sequence += 1) {
      send?.({ sequence, width: 1200, height: 800, image: filler });
    }
    // The page resized behind the backpressure. This frame is dropped, so the member never sees it.
    send?.({ sequence: 14, width: 400, height: 300, image: filler });

    socket.send(
      encodeBrowserViewInput({
        type: "pointer",
        action: "down",
        x: 0.5,
        y: 0.25,
        button: "left",
        clickCount: 1,
        deltaX: 0,
        deltaY: 0,
        modifiers: 0,
      }),
    );
    // The point is a fraction of the frame on the member's screen, which is still the 1200x800 one.
    // Expanding it with the dropped frame would put the click at (200, 75) on a page nobody saw.
    await vi.waitFor(() => expect(dispatched).toEqual([expect.objectContaining({ x: 600, y: 200 })]));
    socket.resume();
    socket.close();
    await gateway.stop();
  });

  it("expands a point with the frame the member named, not the newest one", async () => {
    const dispatched: BrowserViewportInput[] = [];
    let send: ((frame: { sequence: number; width: number; height: number; image: Uint8Array }) => void) | undefined;
    const gateway = new BrowserViewGateway({
      browser: {
        startView: async (_tabId, onFrame) => {
          send = onFrame;
          return async () => undefined;
        },
        dispatchViewInput: async (_tabId, input) => {
          dispatched.push(input);
        },
      },
      authenticate: () => null,
    });
    const origin = await serve(gateway);
    const session = gateway.createSession({ memberId: "member-1", teamSessionId: TEAM_SESSION, tabId: "tab-1" });

    const socket = new webSockets.WebSocket(`${origin}${session.streamPath}`, {
      headers: { "X-OpenBot-WebRTC-Session": TEAM_SESSION },
    });
    const frames = collect(socket);
    await new Promise((resolve) => socket.once("open", resolve));
    await vi.waitFor(() => expect(send).toBeDefined());
    send?.({ sequence: 1, width: 1200, height: 800, image: new Uint8Array([0xff, 0xd8, 0xff]) });
    // The page resized. This frame is on its way to the member, who is still looking at the first.
    send?.({ sequence: 2, width: 400, height: 300, image: new Uint8Array([0xff, 0xd8, 0xff]) });
    await vi.waitFor(() => expect(frames).toHaveLength(2));

    socket.send(
      encodeBrowserViewInput({
        type: "pointer",
        action: "down",
        x: 0.5,
        y: 0.25,
        sequence: 1,
        button: "left",
        clickCount: 1,
        deltaX: 0,
        deltaY: 0,
        modifiers: 0,
      }),
    );
    // The frame the member named, not the newest one: expanding with frame 2 puts this at (200, 75).
    await vi.waitFor(() => expect(dispatched).toEqual([expect.objectContaining({ x: 600, y: 200 })]));
    socket.close();
    await gateway.stop();
  });

  it("keeps a point on the frame still showing, and drops it once a newer frame is named", async () => {
    const dispatched: BrowserViewportInput[] = [];
    let send: ((frame: { sequence: number; width: number; height: number; image: Uint8Array }) => void) | undefined;
    const gateway = new BrowserViewGateway({
      browser: {
        startView: async (_tabId, onFrame) => {
          send = onFrame;
          return async () => undefined;
        },
        dispatchViewInput: async (_tabId, input) => {
          dispatched.push(input);
        },
      },
      authenticate: () => null,
    });
    const origin = await serve(gateway);
    const session = gateway.createSession({ memberId: "member-1", teamSessionId: TEAM_SESSION, tabId: "tab-1" });

    const socket = new webSockets.WebSocket(`${origin}${session.streamPath}`, {
      headers: { "X-OpenBot-WebRTC-Session": TEAM_SESSION },
    });
    const frames = collect(socket);
    await new Promise((resolve) => socket.once("open", resolve));
    await vi.waitFor(() => expect(send).toBeDefined());
    send?.({ sequence: 1, width: 1200, height: 800, image: new Uint8Array([0xff, 0xd8, 0xff]) });
    // More frames than any fixed window. The member is still looking at the first: nothing has
    // said otherwise, so a click there is a click on that page, not one to throw away.
    for (let sequence = 2; sequence <= 9; sequence += 1) {
      send?.({ sequence, width: 400, height: 300, image: new Uint8Array([0xff, 0xd8, 0xff]) });
    }
    await vi.waitFor(() => expect(frames).toHaveLength(9));

    const point = {
      type: "pointer" as const,
      action: "down" as const,
      x: 0.5,
      y: 0.25,
      button: "left" as const,
      clickCount: 1,
      deltaX: 0,
      deltaY: 0,
      modifiers: 0,
    };
    socket.send(encodeBrowserViewInput({ ...point, sequence: 1 }));
    // Naming frame 9 says that frame is on screen now. The next click on frame 1 is a frame the
    // member has left, and it must not be expanded with frame 9's size either.
    socket.send(encodeBrowserViewInput({ ...point, sequence: 9 }));
    socket.send(encodeBrowserViewInput({ ...point, sequence: 1 }));
    socket.send(encodeBrowserViewInput({ ...point, action: "up", sequence: 9 }));
    await vi.waitFor(() =>
      expect(dispatched).toEqual([
        expect.objectContaining({ action: "down", x: 600, y: 200 }),
        expect.objectContaining({ action: "down", x: 200, y: 75 }),
        expect.objectContaining({ action: "up", x: 200, y: 75 }),
      ]),
    );
    socket.close();
    await gateway.stop();
  });

  it("closes invalidated views and rejects reuse of their session", async () => {
    let invalidate: (() => void) | undefined;
    const stop = vi.fn(async () => undefined);
    const dispatch = vi.fn(async () => undefined);
    const gateway = new BrowserViewGateway({
      browser: {
        startView: async (_tabId, _onFrame, onInvalidated) => {
          invalidate = onInvalidated;
          return stop;
        },
        dispatchViewInput: dispatch,
      },
      authenticate: () => null,
    });
    const origin = await serve(gateway);
    const session = gateway.createSession({ memberId: "member-1", teamSessionId: TEAM_SESSION, tabId: "tab-1" });
    const socket = new webSockets.WebSocket(`${origin}${session.streamPath}`, {
      headers: { "X-OpenBot-WebRTC-Session": TEAM_SESSION },
    });
    await new Promise((resolve) => socket.once("open", resolve));
    await vi.waitFor(() => expect(invalidate).toBeDefined());
    const closed = new Promise((resolve) => socket.once("close", resolve));
    invalidate?.();
    await closed;
    expect(gateway.activeViewCount()).toBe(0);
    expect(stop).toHaveBeenCalledOnce();
    expect(dispatch).not.toHaveBeenCalled();
    const retry = new webSockets.WebSocket(`${origin}${session.streamPath}`, {
      headers: { "X-OpenBot-WebRTC-Session": TEAM_SESSION },
    });
    const failure = await new Promise<string>((resolve) => retry.once("error", (error) => resolve(error.message)));
    expect(failure).toContain("401");
    await gateway.stop();
  });

  it("refuses a socket that names neither the session nor its member", async () => {
    const gateway = new BrowserViewGateway({
      browser: {
        startView: async () => async () => undefined,
        dispatchViewInput: async () => undefined,
      },
      authenticate: (token) => (token === "other-member-token" ? { id: "member-2" } : null),
    });
    const origin = await serve(gateway);
    const session = gateway.createSession({ memberId: "member-1", teamSessionId: TEAM_SESSION, tabId: "tab-1" });

    for (const options of [
      { headers: { "X-OpenBot-WebRTC-Session": "another-team-session" } },
      { protocols: ["openbot-token.other-member-token"] },
      {},
    ]) {
      const socket = new webSockets.WebSocket(`${origin}${session.streamPath}`, options.protocols ?? [], options);
      const failure = await new Promise<string>((resolve) => socket.once("error", (error) => resolve(error.message)));
      expect(failure).toContain("401");
    }
    await gateway.stop();
  });

  it("counts only views with a live socket", async () => {
    const gateway = new BrowserViewGateway({
      browser: {
        startView: async () => async () => undefined,
        dispatchViewInput: async () => undefined,
      },
      authenticate: () => null,
    });
    const origin = await serve(gateway);
    expect(gateway.activeViewCount()).toBe(0);
    const session = gateway.createSession({ memberId: "member-1", teamSessionId: TEAM_SESSION, tabId: "tab-1" });
    expect(gateway.activeViewCount()).toBe(0);

    const before = restartActivityGeneration();
    const socket = new webSockets.WebSocket(`${origin}${session.streamPath}`, {
      headers: { "X-OpenBot-WebRTC-Session": TEAM_SESSION },
    });
    await new Promise((resolve) => socket.once("open", resolve));
    await vi.waitFor(() => expect(gateway.activeViewCount()).toBe(1));
    socket.close();
    await vi.waitFor(() => expect(gateway.activeViewCount()).toBe(0));
    expect(restartActivityGeneration()).toBeGreaterThan(before);
    await gateway.stop();
  });
});

async function serve(gateway: BrowserViewGateway): Promise<string> {
  const server = createServer();
  server.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (!gateway.handlesUpgrade(url)) return socket.destroy();
    gateway.handleUpgrade(request, socket, head, url);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = z.object({ port: z.number().int() }).parse(server.address());
  closers.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return `ws://127.0.0.1:${address.port}`;
}

function collect(socket: Ws.WebSocket): Uint8Array[] {
  const frames: Uint8Array[] = [];
  socket.on("message", (data, binary) => {
    if (binary && !Array.isArray(data) && !(data instanceof ArrayBuffer)) frames.push(new Uint8Array(data));
  });
  return frames;
}
