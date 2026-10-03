import { EventEmitter, once } from "node:events";
import { isString } from "@openbot/contracts/runtime-values";
import { Effect } from "effect";
import { assert, describe, expect, it } from "vitest";
import WebSocket from "ws";
import {
  decodeRemoteDesktopSignalBinary,
  decodeRemoteDesktopSignalControl,
  encodeRemoteDesktopSignalBinary,
  encodeRemoteDesktopSignalControl,
} from "./remote-desktop-signal";
import { RemoteWorkflowError, remoteCall } from "./remote-service-effects";
import { RemoteViewerProxy } from "./remote-viewer-proxy";

describe("RemoteViewerProxy", () => {
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
    const viewerUrl = await Effect.runPromise(
      proxy
        .viewerUrl("host-1", "/v1/remote-screen/sessions/session-1/viewer")
        .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
    );
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
    await Effect.runPromise(proxy.stop().pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)));
  });

  it("closes only the affected viewer when desktop forwarding fails", async () => {
    const transport = new FailingFrameTransport();
    const proxy = new RemoteViewerProxy({ transport, fetchResource: () => Effect.sync(() => new Response()) });
    const viewerUrl = await Effect.runPromise(
      proxy
        .viewerUrl("host-1", "/v1/remote-screen/sessions/session-1/viewer")
        .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
    );
    const socketUrl = new URL(viewerUrl);
    socketUrl.protocol = "ws:";
    socketUrl.pathname = socketUrl.pathname.replace(/\/viewer$/u, "/stream");
    const socket = new WebSocket(socketUrl);
    await once(socket, "open");
    await transport.opened;
    socket.send("offer-text");
    const [code] = await once(socket, "close");
    expect(code).toBe(1011);
    await Effect.runPromise(proxy.stop().pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)));
  });

  it("closes a viewer when its open desktop forwarding queue exceeds the limit", async () => {
    const transport = new SlowFrameTransport();
    const proxy = new RemoteViewerProxy({ transport, fetchResource: () => Effect.sync(() => new Response()) });
    const viewerUrl = await Effect.runPromise(
      proxy
        .viewerUrl("host-1", "/v1/remote-screen/sessions/session-1/viewer")
        .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
    );
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
    await Effect.runPromise(proxy.stop().pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)));
  });
});

class FakeTransport extends EventEmitter {
  sendDesktop(hostId: string, data: string | ArrayBuffer): Effect.Effect<void, RemoteWorkflowError> {
    return Effect.gen({ self: this }, function* () {
      if (isString(data)) {
        const control = decodeRemoteDesktopSignalControl(data);
        if (control.type === "open") {
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
