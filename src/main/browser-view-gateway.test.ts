import { Effect } from "effect";
import { restartActivityGeneration } from "../backend/restart-activity";

// @vitest-environment node

import { createServer, type IncomingMessage } from "node:http";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { Duplex } from "node:stream";
import {
  BROWSER_VIEW_FRAME_ACK_QUERY,
  BROWSER_VIEW_MAX_CLIPBOARD_TEXT,
  decodeBrowserViewCopied,
  decodeBrowserViewFrame,
  encodeBrowserViewInput,
} from "@openbot/contracts/team-protocol/browser-view-v1";
import { afterEach, assert, describe, expect, it, vi } from "vitest";
import type * as Ws from "ws";
import { z } from "zod";
import type { BrowserViewportInput } from "../backend/browser-cdp";
import { browserFailure } from "../backend/browser-effects";
import { runCauseEffect } from "../backend/effect-boundary";
import { BrowserViewGateway } from "./browser-view-gateway";

const requireModule = createRequire(import.meta.url);
const webSockets: typeof Ws = requireModule(join(dirname(requireModule.resolve("ws/package.json")), "index.js"));
const TEAM_SESSION = "team-session-1";
/** A page with nothing selected. */
const noCopy = () => Effect.succeed("");

/** A client that will name the frame it has drawn. The host keeps sizes only for this socket. */
function acknowledgingViewUrl(origin: string, streamPath: string): string {
  const url = new URL(`${origin}${streamPath}`);
  url.searchParams.set(BROWSER_VIEW_FRAME_ACK_QUERY, "1");
  return url.toString();
}
const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

describe("the live browser view on a host", () => {
  // Failure modes: a stopped upgrade server rejects new views; old sessions survive a restart;
  // a restarted view loses frames or input. Exercise the real socket for each case.
  it("streams frames and input after the Team API stops and starts", async () => {
    const stopView = vi.fn(() => Effect.void);
    const dispatch = vi.fn(() => Effect.void);
    const gateway = new BrowserViewGateway({
      browser: {
        startView: (_tabId, onFrame) =>
          Effect.sync(() => {
            onFrame({ sequence: 1, width: 1200, height: 800, image: new Uint8Array([0xff, 0xd8, 0xff]) });
            return stopView;
          }),
        copyViewSelection: noCopy,
        dispatchViewInput: dispatch,
      },
      authenticate: () => null,
    });
    const origin = await serve(gateway);
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const session = gateway.createSession({ memberId: "member-1", teamSessionId: TEAM_SESSION, tabId: "tab-1" });
      const socket = new webSockets.WebSocket(`${origin}${session.streamPath}`, {
        headers: { "X-OpenBot-WebRTC-Session": TEAM_SESSION },
      });
      const frames = collect(socket);
      await new Promise<void>((resolve, reject) => {
        socket.once("open", resolve);
        socket.once("error", reject);
      });
      await vi.waitFor(() => expect(frames).toHaveLength(1));
      assert(frames[0]);
      expect(decodeBrowserViewFrame(frames[0])).toMatchObject({ sequence: 1, width: 1200, height: 800 });
      socket.send(
        encodeBrowserViewInput({ type: "key", action: "down", key: "a", code: "KeyA", text: "", modifiers: 0 }),
      );
      await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(attempt));
      expect(dispatch).toHaveBeenLastCalledWith("tab-1", expect.objectContaining({ type: "key", key: "a" }));
      const closed = new Promise<void>((resolve) => socket.once("close", () => resolve()));
      await runCauseEffect(gateway.stop());
      await closed;
      expect(stopView).toHaveBeenCalledTimes(attempt);
      expect(gateway.activeViewCount()).toBe(0);
      expect(await runCauseEffect(gateway.closeMemberSession(session.id, "member-1"))).toBe(false);
    }
  });

  // Failure modes: a paste longer than the old 4 KiB input bound is dropped; a key typed after a paste
  // lands before it; a copy gets no answer and the client's clipboard write waits for ever; a
  // protected tab's selection reaches the member; a selection too long to send is sent, or is not
  // reported.
  it("pastes the member's text in order and answers every copy", async () => {
    const dispatched: BrowserViewportInput[] = [];
    // A tab whose fields hold a secret, a selection too long to send, then one that is sent.
    const copySelection = vi.fn((_tabId: string, _max: number) => {
      const call = copySelection.mock.calls.length;
      if (call === 1) return Effect.fail(browserFailure(new Error("protected")));
      return Effect.succeed(call === 2 ? null : "copied text");
    });
    // A paste takes several CDP calls on a real page. This one gives the event loop a turn, which is
    // when the key sent right behind it is read from the socket.
    const pasting = () => new Promise<void>((resolve) => setImmediate(() => setImmediate(resolve)));
    const gateway = new BrowserViewGateway({
      browser: {
        startView: (_tabId, onFrame) =>
          Effect.sync(() => {
            onFrame({ sequence: 1, width: 1200, height: 800, image: new Uint8Array([0xff, 0xd8, 0xff]) });
            return () => Effect.void;
          }),
        copyViewSelection: copySelection,
        dispatchViewInput: (_tabId, input) =>
          Effect.promise(() => (input.type === "paste" ? pasting() : Promise.resolve())).pipe(
            Effect.andThen(
              Effect.sync(() => {
                dispatched.push(input);
              }),
            ),
          ),
      },
      authenticate: () => null,
    });
    const origin = await serve(gateway);
    const session = gateway.createSession({ memberId: "member-1", teamSessionId: TEAM_SESSION, tabId: "tab-1" });
    const socket = new webSockets.WebSocket(`${origin}${session.streamPath}`, {
      headers: { "X-OpenBot-WebRTC-Session": TEAM_SESSION },
    });
    const answers: string[] = [];
    socket.on("message", (data, binary) => {
      if (!binary) answers.push(data.toString());
    });
    await new Promise((resolve) => socket.once("open", resolve));

    const text = "a pasted paragraph ".repeat(1_000);
    const key = { type: "key", action: "char", key: "!", code: "Digit1", text: "!", modifiers: 8 } as const;
    socket.send(encodeBrowserViewInput({ type: "paste", text }));
    socket.send(encodeBrowserViewInput(key));
    // The key and the copy reach the host while the paste still runs. They wait for it.
    socket.send(encodeBrowserViewInput({ type: "copy" }));
    await vi.waitFor(() => expect(answers).toHaveLength(1));
    expect(dispatched).toEqual([{ type: "paste", text }, key]);

    for (const index of [1, 2]) {
      socket.send(encodeBrowserViewInput({ type: "copy" }));
      await vi.waitFor(() => expect(answers).toHaveLength(index + 1));
    }
    expect(answers.map(decodeBrowserViewCopied)).toEqual([
      { type: "copied", text: "" },
      { type: "copyTooLarge" },
      { type: "copied", text: "copied text" },
    ]);
    expect(copySelection).toHaveBeenLastCalledWith("tab-1", BROWSER_VIEW_MAX_CLIPBOARD_TEXT);
    socket.close();
    await runCauseEffect(gateway.stop());
  });

  it("redacts a browser start failure before sending its close reason", async () => {
    const gateway = new BrowserViewGateway({
      browser: {
        startView: () => Effect.fail(browserFailure(new Error("CDP failed: token=secret-value-123456"))),
        copyViewSelection: noCopy,
        dispatchViewInput: () => Effect.void,
      },
      authenticate: () => null,
    });
    const origin = await serve(gateway);
    const session = gateway.createSession({ memberId: "member-1", teamSessionId: TEAM_SESSION, tabId: "tab-1" });
    const socket = new webSockets.WebSocket(`${origin}${session.streamPath}`, {
      headers: { "X-OpenBot-WebRTC-Session": TEAM_SESSION },
    });
    const ended = await new Promise<{ code: number; reason: string }>((resolve, reject) => {
      socket.once("close", (code, reason) => resolve({ code, reason: reason.toString() }));
      socket.once("error", reject);
    });
    expect(ended).toEqual({ code: 1011, reason: "CDP failed: token=[redacted]" });
    await runCauseEffect(gateway.stop());
  });

  it("sends the tab's frames and dispatches a click at the point on the frame", async () => {
    const dispatched: BrowserViewportInput[] = [];
    let send: ((frame: { sequence: number; width: number; height: number; image: Uint8Array }) => void) | undefined;
    const gateway = new BrowserViewGateway({
      browser: {
        startView: (_tabId, onFrame) =>
          Effect.sync(() => {
            send = onFrame;
            return () => Effect.void;
          }),
        copyViewSelection: noCopy,
        dispatchViewInput: (_tabId, input) =>
          Effect.sync(() => {
            dispatched.push(input);
          }),
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
    const [frame] = frames;
    assert(frame);
    expect(decodeBrowserViewFrame(frame)).toMatchObject({ sequence: 1, width: 1200, height: 800 });

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
    await runCauseEffect(gateway.stop());
  });

  it("keeps a click on the last frame the member saw when a newer frame is dropped", async () => {
    const dispatched: BrowserViewportInput[] = [];
    let send: ((frame: { sequence: number; width: number; height: number; image: Uint8Array }) => void) | undefined;
    const gateway = new BrowserViewGateway({
      browser: {
        startView: (_tabId, onFrame) =>
          Effect.sync(() => {
            send = onFrame;
            return () => Effect.void;
          }),
        copyViewSelection: noCopy,
        dispatchViewInput: (_tabId, input) =>
          Effect.sync(() => {
            dispatched.push(input);
          }),
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
    await runCauseEffect(gateway.stop());
  });

  it("expands a point with the frame the member named, not the newest one", async () => {
    const dispatched: BrowserViewportInput[] = [];
    let send: ((frame: { sequence: number; width: number; height: number; image: Uint8Array }) => void) | undefined;
    const gateway = new BrowserViewGateway({
      browser: {
        startView: (_tabId, onFrame) =>
          Effect.sync(() => {
            send = onFrame;
            return () => Effect.void;
          }),
        copyViewSelection: noCopy,
        dispatchViewInput: (_tabId, input) =>
          Effect.sync(() => {
            dispatched.push(input);
          }),
      },
      authenticate: () => null,
    });
    const origin = await serve(gateway);
    const session = gateway.createSession({ memberId: "member-1", teamSessionId: TEAM_SESSION, tabId: "tab-1" });

    const socket = new webSockets.WebSocket(acknowledgingViewUrl(origin, session.streamPath), {
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
    await runCauseEffect(gateway.stop());
  });

  it("keeps a point on the frame still showing, and drops it once a newer frame is named", async () => {
    const dispatched: BrowserViewportInput[] = [];
    let send: ((frame: { sequence: number; width: number; height: number; image: Uint8Array }) => void) | undefined;
    const gateway = new BrowserViewGateway({
      browser: {
        startView: (_tabId, onFrame) =>
          Effect.sync(() => {
            send = onFrame;
            return () => Effect.void;
          }),
        copyViewSelection: noCopy,
        dispatchViewInput: (_tabId, input) =>
          Effect.sync(() => {
            dispatched.push(input);
          }),
      },
      authenticate: () => null,
    });
    const origin = await serve(gateway);
    const session = gateway.createSession({ memberId: "member-1", teamSessionId: TEAM_SESSION, tabId: "tab-1" });

    const socket = new webSockets.WebSocket(acknowledgingViewUrl(origin, session.streamPath), {
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
    await runCauseEffect(gateway.stop());
  });

  it("forgets frames older than the one the member has drawn, without a click", async () => {
    const dispatched: BrowserViewportInput[] = [];
    let send: ((frame: { sequence: number; width: number; height: number; image: Uint8Array }) => void) | undefined;
    const gateway = new BrowserViewGateway({
      browser: {
        startView: (_tabId, onFrame) =>
          Effect.sync(() => {
            send = onFrame;
            return () => Effect.void;
          }),
        copyViewSelection: noCopy,
        dispatchViewInput: (_tabId, input) =>
          Effect.sync(() => {
            dispatched.push(input);
          }),
      },
      authenticate: () => null,
    });
    const origin = await serve(gateway);
    const session = gateway.createSession({ memberId: "member-1", teamSessionId: TEAM_SESSION, tabId: "tab-1" });

    const socket = new webSockets.WebSocket(acknowledgingViewUrl(origin, session.streamPath), {
      headers: { "X-OpenBot-WebRTC-Session": TEAM_SESSION },
    });
    const frames = collect(socket);
    await new Promise((resolve) => socket.once("open", resolve));
    await vi.waitFor(() => expect(send).toBeDefined());
    send?.({ sequence: 1, width: 1200, height: 800, image: new Uint8Array([0xff, 0xd8, 0xff]) });
    for (let sequence = 2; sequence <= 4; sequence += 1) {
      send?.({ sequence, width: 400, height: 300, image: new Uint8Array([0xff, 0xd8, 0xff]) });
    }
    await vi.waitFor(() => expect(frames).toHaveLength(4));

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
    // The member is watching frame 3 and has not touched the page. Frame 4 is still on its way.
    socket.send(encodeBrowserViewInput({ type: "ack", sequence: 3 }));
    socket.send(encodeBrowserViewInput({ ...point, sequence: 1 }));
    socket.send(encodeBrowserViewInput({ ...point, sequence: 3 }));
    socket.send(encodeBrowserViewInput({ ...point, sequence: 4 }));
    await vi.waitFor(() =>
      expect(dispatched).toEqual([
        expect.objectContaining({ x: 200, y: 75 }),
        expect.objectContaining({ x: 200, y: 75 }),
      ]),
    );
    socket.close();
    await runCauseEffect(gateway.stop());
  });

  it("does not keep a frame size for a client that never acknowledges frames", async () => {
    const dispatched: BrowserViewportInput[] = [];
    let send: ((frame: { sequence: number; width: number; height: number; image: Uint8Array }) => void) | undefined;
    const gateway = new BrowserViewGateway({
      browser: {
        startView: (_tabId, onFrame) =>
          Effect.sync(() => {
            send = onFrame;
            return () => Effect.void;
          }),
        copyViewSelection: noCopy,
        dispatchViewInput: (_tabId, input) =>
          Effect.sync(() => {
            dispatched.push(input);
          }),
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
    send?.({ sequence: 2, width: 400, height: 300, image: new Uint8Array([0xff, 0xd8, 0xff]) });
    await vi.waitFor(() => expect(frames).toHaveLength(2));

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
    // This client did not ask the host to remember frames. A named point has no size to use, and
    // the point every released client sends still lands on the newest frame.
    socket.send(encodeBrowserViewInput({ type: "ack", sequence: 1 }));
    socket.send(encodeBrowserViewInput({ ...point, sequence: 1 }));
    socket.send(encodeBrowserViewInput({ ...point }));
    await vi.waitFor(() => expect(dispatched).toEqual([expect.objectContaining({ x: 200, y: 75 })]));
    socket.close();
    await runCauseEffect(gateway.stop());
  });

  it("closes a view whose client stops acknowledging frames", async () => {
    let send: ((frame: { sequence: number; width: number; height: number; image: Uint8Array }) => void) | undefined;
    const gateway = new BrowserViewGateway({
      browser: {
        startView: (_tabId, onFrame) =>
          Effect.sync(() => {
            send = onFrame;
            return () => Effect.void;
          }),
        copyViewSelection: noCopy,
        dispatchViewInput: () => Effect.void,
      },
      authenticate: () => null,
    });
    const origin = await serve(gateway);
    const session = gateway.createSession({ memberId: "member-1", teamSessionId: TEAM_SESSION, tabId: "tab-1" });
    const socket = new webSockets.WebSocket(acknowledgingViewUrl(origin, session.streamPath), {
      headers: { "X-OpenBot-WebRTC-Session": TEAM_SESSION },
    });
    const frames = collect(socket);
    const closed = new Promise((resolve) => socket.once("close", resolve));
    await new Promise((resolve) => socket.once("open", resolve));
    await vi.waitFor(() => expect(send).toBeDefined());
    // One past the host's unacknowledged-frame cap. A client that keeps up never reaches it.
    for (let sequence = 1; sequence <= 121; sequence += 1) {
      send?.({ sequence, width: 800, height: 600, image: new Uint8Array([0xff, 0xd8, 0xff]) });
    }
    await closed;
    expect(frames.length).toBeLessThanOrEqual(121);
    expect(gateway.activeViewCount()).toBe(0);
    await runCauseEffect(gateway.stop());
  });

  it("keeps the view open while drawn frames are acknowledged inside the backlog", async () => {
    const dispatched: BrowserViewportInput[] = [];
    let send: ((frame: { sequence: number; width: number; height: number; image: Uint8Array }) => void) | undefined;
    const gateway = new BrowserViewGateway({
      browser: {
        startView: (_tabId, onFrame) =>
          Effect.sync(() => {
            send = onFrame;
            return () => Effect.void;
          }),
        copyViewSelection: noCopy,
        dispatchViewInput: (_tabId, input) =>
          Effect.sync(() => {
            dispatched.push(input);
          }),
      },
      authenticate: () => null,
    });
    const origin = await serve(gateway);
    const session = gateway.createSession({ memberId: "member-1", teamSessionId: TEAM_SESSION, tabId: "tab-1" });
    const socket = new webSockets.WebSocket(acknowledgingViewUrl(origin, session.streamPath), {
      headers: { "X-OpenBot-WebRTC-Session": TEAM_SESSION },
    });
    await new Promise((resolve) => socket.once("open", resolve));
    await vi.waitFor(() => expect(send).toBeDefined());
    let seen = 0;
    for (let sequence = 1; sequence <= 200; sequence += 1) {
      send?.({ sequence, width: 800, height: 600, image: new Uint8Array([0xff, 0xd8, 0xff]) });
      if (sequence % 30 !== 0) continue;
      // The acknowledgement has to be applied before the next burst, which is what a live
      // socket does between frames. Sending the whole stream in one turn would close a view
      // that is keeping up.
      socket.send(encodeBrowserViewInput({ type: "ack", sequence }));
      socket.send(
        encodeBrowserViewInput({
          type: "pointer",
          action: "down",
          x: 0.5,
          y: 0.25,
          sequence,
          button: "left",
          clickCount: 1,
          deltaX: 0,
          deltaY: 0,
          modifiers: 0,
        }),
      );
      seen += 1;
      await vi.waitFor(() => expect(dispatched).toHaveLength(seen));
    }
    expect(socket.readyState).toBe(webSockets.WebSocket.OPEN);
    socket.close();
    await runCauseEffect(gateway.stop());
  });

  it("closes invalidated views and rejects reuse of their session", async () => {
    let invalidate: ((reason: string) => void) | undefined;
    const stop = vi.fn(() => Effect.void);
    const dispatch = vi.fn(() => Effect.void);
    const gateway = new BrowserViewGateway({
      browser: {
        startView: (_tabId, _onFrame, onEnded) =>
          Effect.sync(() => {
            invalidate = onEnded;
            return stop;
          }),
        copyViewSelection: noCopy,
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
    invalidate?.("Authentication changed the browser view. Open a new view to continue.");
    await closed;
    expect(gateway.activeViewCount()).toBe(0);
    expect(stop).toHaveBeenCalledOnce();
    expect(dispatch).not.toHaveBeenCalled();
    const retry = new webSockets.WebSocket(`${origin}${session.streamPath}`, {
      headers: { "X-OpenBot-WebRTC-Session": TEAM_SESSION },
    });
    const failure = await new Promise<string>((resolve) => retry.once("error", (error) => resolve(error.message)));
    expect(failure).toContain("401");
    await runCauseEffect(gateway.stop());
  });

  it("refuses a socket that names neither the session nor its member", async () => {
    const gateway = new BrowserViewGateway({
      browser: {
        startView: () => Effect.succeed(() => Effect.void),
        copyViewSelection: noCopy,
        dispatchViewInput: () => Effect.void,
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
    await runCauseEffect(gateway.stop());
  });

  it("counts only views with a live socket", async () => {
    const gateway = new BrowserViewGateway({
      browser: {
        startView: () => Effect.succeed(() => Effect.void),
        copyViewSelection: noCopy,
        dispatchViewInput: () => Effect.void,
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
    await runCauseEffect(gateway.stop());
  });

  it("releases a session after an abrupt stream disconnect", async () => {
    const startView = vi.fn(() => Effect.succeed(() => Effect.void));
    const gateway = new BrowserViewGateway({
      browser: {
        startView,
        copyViewSelection: noCopy,
        dispatchViewInput: () => Effect.void,
      },
      authenticate: () => null,
      maxSessions: 1,
    });
    const origin = await serve(gateway);
    const session = gateway.createSession({ memberId: "member-1", teamSessionId: TEAM_SESSION, tabId: "tab-1" });
    const socket = new webSockets.WebSocket(`${origin}${session.streamPath}`, {
      headers: { "X-OpenBot-WebRTC-Session": TEAM_SESSION },
    });
    await new Promise((resolve) => socket.once("open", resolve));
    await vi.waitFor(() => expect(startView).toHaveBeenCalledOnce());

    const closed = new Promise<void>((resolve) => socket.once("close", () => resolve()));
    socket.terminate();
    await closed;
    await vi.waitFor(() => expect(gateway.activeViewCount()).toBe(0));

    expect(() =>
      gateway.createSession({ memberId: "member-1", teamSessionId: TEAM_SESSION, tabId: "tab-2" }),
    ).not.toThrow();
    await runCauseEffect(gateway.stop());
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
