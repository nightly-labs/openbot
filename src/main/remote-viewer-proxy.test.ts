import { EventEmitter, once } from "node:events";
import { isString } from "@openbot/contracts/runtime-values";
import { Effect } from "effect";
import { assert, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { runCauseEffect } from "../backend/effect-boundary";
import {
  decodeRemoteDesktopSignalBinary,
  decodeRemoteDesktopSignalControl,
  encodeRemoteDesktopSignalBinary,
  encodeRemoteDesktopSignalControl,
} from "./remote-desktop-signal";
import { RemoteWorkflowError, remoteCall } from "./remote-service-effects";
import { RemoteViewerProxy } from "./remote-viewer-proxy";

describe("RemoteViewerProxy", () => {
  it.each([1006, 1005, 1000, undefined])("preserves the result of tunneled close %s", async (code) => {
    const transport = new FakeTransport();
    const proxy = new RemoteViewerProxy({ transport, fetchResource: () => Effect.sync(() => new Response()) });
    const url = new URL(await runCauseEffect(proxy.viewerUrl("host-1", "/v1/remote-screen/sessions/session-1/stream")));
    url.protocol = "ws:";
    const opened = once(transport, "streamOpened");
    const socket = new WebSocket(url);
    await once(socket, "open");
    const [streamId] = await opened;
    const closed = once(socket, "close");
    transport.emit("desktopData", "host-1", encodeRemoteDesktopSignalControl({ type: "close", streamId, code }));
    const [actual] = await closed;
    expect(actual).toBe(code === 1006 ? 1011 : 1000);
    await runCauseEffect(proxy.stop());
  });

  it("ends only the disconnected host's view and permits reopening", async () => {
    const transport = new FakeTransport();
    const proxy = new RemoteViewerProxy({ transport, fetchResource: () => Effect.sync(() => new Response()) });
    const open = async (hostId: string) => {
      const url = new URL(await runCauseEffect(proxy.viewerUrl(hostId, "/v1/remote-screen/sessions/session-1/stream")));
      url.protocol = "ws:";
      const socket = new WebSocket(url);
      await once(socket, "open");
      return socket;
    };
    const first = await open("host-1");
    const other = await open("host-2");
    const closed = once(first, "close");
    transport.emit("disconnected", "host-1");
    const [code, reason] = await closed;
    expect(code).toBe(1011);
    expect(reason.toString()).toBe("The WebRTC host disconnected.");
    expect(other.readyState).toBe(WebSocket.OPEN);
    const reopened = await open("host-1");
    expect(reopened.readyState).toBe(WebSocket.OPEN);
    reopened.close();
    other.close();
    await runCauseEffect(proxy.stop());
    expect(transport.listenerCount("disconnected")).toBe(0);
  });

  it("serves viewer resources on loopback and bridges Moonlight signal frames without Base64", async () => {
    const transport = new FakeTransport();
    const proxy = new RemoteViewerProxy({
      transport,
      fetchResource: () =>
        Effect.sync(
          () =>
            new Response(
              '<script>const session=/^\\/v1\\/remote-screen\\/sessions\\/([A-Za-z0-9-]+)/.exec(location.pathname);fetch("/v1/remote-screen/session")</script>',
              {
                headers: { "Content-Type": "text/html" },
              },
            ),
        ),
    });
    const viewerUrl = await runCauseEffect(proxy.viewerUrl("host-1", "/v1/remote-screen/sessions/session-1/viewer"));
    expect(new URL(viewerUrl).hostname).toBe("127.0.0.1");
    const html = await (await fetch(viewerUrl)).text();
    const [localPrefix] = new URL(viewerUrl).pathname.split("/v1/");
    assert(localPrefix !== undefined);
    expect(html).toContain(`${localPrefix}/v1/remote-screen/session`);
    expect(html).toContain(`^${localPrefix.replaceAll("/", "\\/")}\\/v1\\/remote-screen\\/sessions\\/([A-Za-z0-9-]+)`);

    const socketUrl = new URL(viewerUrl);
    socketUrl.protocol = "ws:";
    socketUrl.pathname = socketUrl.pathname.replace(/\/viewer$/u, "/stream");
    const socket = new WebSocket(socketUrl);
    await once(socket, "open");
    socket.send("offer-text");
    const [text] = await once(socket, "message");
    expect(text.toString()).toBe("offer-text");
    const binary = new Uint8Array([1, 2, 3, 4]);
    socket.send(binary);
    const [echoed, isBinary] = await once(socket, "message");
    expect(isBinary).toBe(true);
    if (!Buffer.isBuffer(echoed)) throw new Error("The viewer did not return a binary WebSocket frame.");
    expect(new Uint8Array(echoed)).toEqual(binary);
    const viewer = new URL(viewerUrl);
    const tokenPath = viewer.pathname.split("/host-1/")[0];
    expect((await fetch(`${viewer.origin}${tokenPath}/%/x`)).status).toBe(404);
    socket.close();
    await runCauseEffect(proxy.stop());
  });

  it("closes only the affected viewer when desktop forwarding fails", async () => {
    const transport = new FailingFrameTransport();
    const proxy = new RemoteViewerProxy({ transport, fetchResource: () => Effect.sync(() => new Response()) });
    const viewerUrl = await runCauseEffect(proxy.viewerUrl("host-1", "/v1/remote-screen/sessions/session-1/viewer"));
    const socketUrl = new URL(viewerUrl);
    socketUrl.protocol = "ws:";
    socketUrl.pathname = socketUrl.pathname.replace(/\/viewer$/u, "/stream");
    const socket = new WebSocket(socketUrl);
    await once(socket, "open");
    await transport.opened;
    socket.send("offer-text");
    const [code] = await once(socket, "close");
    expect(code).toBe(1011);
    await runCauseEffect(proxy.stop());
  });

  it("closes a viewer when its open desktop forwarding queue exceeds the limit", async () => {
    const transport = new SlowFrameTransport();
    const proxy = new RemoteViewerProxy({ transport, fetchResource: () => Effect.sync(() => new Response()) });
    const viewerUrl = await runCauseEffect(proxy.viewerUrl("host-1", "/v1/remote-screen/sessions/session-1/viewer"));
    const socketUrl = new URL(viewerUrl);
    socketUrl.protocol = "ws:";
    socketUrl.pathname = socketUrl.pathname.replace(/\/viewer$/u, "/stream");
    const socket = new WebSocket(socketUrl);
    await once(socket, "open");
    await transport.opened;
    const closed = once(socket, "close");
    for (let index = 0; index < 17; index += 1) socket.send(Buffer.alloc(64 * 1024));

    const [code] = await closed;
    expect(code).toBe(1009);
    transport.release();
    await runCauseEffect(proxy.stop());
  });
});

class FakeTransport extends EventEmitter {
  sendDesktop(hostId: string, data: string | ArrayBuffer): Effect.Effect<void, RemoteWorkflowError> {
    return Effect.gen({ self: this }, function* () {
      if (isString(data)) {
        const control = decodeRemoteDesktopSignalControl(data);
        if (control.type === "open") {
          this.emit("streamOpened", control.streamId);
          queueMicrotask(() =>
            this.emit(
              "desktopData",
              hostId,
              encodeRemoteDesktopSignalControl({ type: "opened", streamId: control.streamId }),
            ),
          );
        } else if (control.type === "text") {
          queueMicrotask(() => this.emit("desktopData", hostId, data));
        }
        return;
      }
      const frame = decodeRemoteDesktopSignalBinary(data);
      queueMicrotask(() =>
        this.emit("desktopData", hostId, encodeRemoteDesktopSignalBinary(frame.streamId, frame.bytes)),
      );
    });
  }
}

class FailingFrameTransport extends FakeTransport {
  readonly opened = new Promise<void>((resolve) => {
    this.once("opened", resolve);
  });

  override sendDesktop(hostId: string, data: string | ArrayBuffer): Effect.Effect<void, RemoteWorkflowError> {
    const send = super.sendDesktop(hostId, data);
    return Effect.gen({ self: this }, function* () {
      if (isString(data) && decodeRemoteDesktopSignalControl(data).type === "text") {
        return yield* new RemoteWorkflowError({ cause: new Error("The desktop channel closed.") });
      }
      yield* send;
      if (isString(data) && decodeRemoteDesktopSignalControl(data).type === "open") this.emit("opened");
    });
  }
}

class SlowFrameTransport extends FakeTransport {
  readonly opened = new Promise<void>((resolve) => {
    this.once("opened", resolve);
  });
  readonly #blocked: Promise<void>;
  readonly release: () => void;

  constructor() {
    super();
    let release!: () => void;
    this.#blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.release = release;
  }

  override sendDesktop(hostId: string, data: string | ArrayBuffer): Effect.Effect<void, RemoteWorkflowError> {
    const send = super.sendDesktop(hostId, data);
    return Effect.gen({ self: this }, function* () {
      if (!isString(data)) yield* remoteCall(() => this.#blocked);
      yield* send;
      if (isString(data) && decodeRemoteDesktopSignalControl(data).type === "open") this.emit("opened");
    });
  }
}
