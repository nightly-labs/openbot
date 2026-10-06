import {
  createServer,
  type IncomingMessage,
  type OutgoingHttpHeaders,
  type Server,
  type ServerResponse,
} from "node:http";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { isString } from "@openbot/contracts/runtime-values";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { browserViewStreamSessionId } from "@openbot/contracts/team-protocol/browser-view-v1";
import { sourceText } from "@openbot/i18n/source";
import { Deferred, Effect, Semaphore } from "effect";
import type * as Ws from "ws";
import { LifecycleGate } from "./lifecycle-gate";
import {
  decodeRemoteDesktopSignalBinary,
  decodeRemoteDesktopSignalControl,
  encodeRemoteDesktopSignalBinary,
  encodeRemoteDesktopSignalControl,
} from "./remote-desktop-signal";
import { RemoteWorkflowError, remoteCall } from "./remote-service-effects";
import { rawDataBytes, rawDataSize, rawDataText, sendableCloseCode } from "./ws-raw-data";

const requireModule = createRequire(import.meta.url);
const webSockets: typeof Ws = requireModule(join(dirname(requireModule.resolve("ws/package.json")), "index.js"));
const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const MAX_PENDING_SIGNAL_BYTES = 1024 * 1024;

interface RemoteViewerTransport {
  sendDesktop(serverId: string, data: string | ArrayBuffer): Effect.Effect<void, RemoteWorkflowError>;
  on(event: "desktopData", listener: (serverId: string, data: string | ArrayBuffer) => void): unknown;
  off(event: "desktopData", listener: (serverId: string, data: string | ArrayBuffer) => void): unknown;
}

interface RemoteViewerProxyOptions {
  transport: RemoteViewerTransport;
  fetchResource: (serverId: string, path: string, init: RequestInit) => Effect.Effect<Response, RemoteWorkflowError>;
}

interface ViewerStream {
  serverId: string;
  socket: Ws.WebSocket;
  opened: boolean;
  pending: Array<{ data: Ws.RawData; binary: boolean }>;
  pendingBytes: number;
  forwardingBytes: number;
  forwarding: Semaphore.Semaphore;
}

export class RemoteViewerProxy {
  readonly #options: RemoteViewerProxyOptions;
  readonly #operations = new Set<Deferred.Deferred<void>>();
  readonly #token = crypto.randomUUID().replaceAll("-", "");
  readonly #webSockets = new webSockets.WebSocketServer({ noServer: true });
  readonly #streams = new Map<string, ViewerStream>();
  #server: Server | null = null;
  #port: number | null = null;
  readonly #lifecycle = new LifecycleGate<number, RemoteWorkflowError>();

  constructor(options: RemoteViewerProxyOptions) {
    this.#options = options;
    options.transport.on("desktopData", this.#onDesktopData);
  }

  readonly viewerUrl = Effect.fn("RemoteViewerProxy.viewerUrl")(function* (
    this: RemoteViewerProxy,
    serverId: string,
    upstreamPath: string,
  ) {
    const port = yield* this.#lifecycle.start(() => this.#start());
    return `http://127.0.0.1:${port}${this.#basePath(serverId)}${upstreamPath}`;
  });

  stop(): Effect.Effect<void, RemoteWorkflowError> {
    return this.#lifecycle.stop(() => this.#stop());
  }

  readonly #stop = Effect.fn("RemoteViewerProxy.stop")(function* (this: RemoteViewerProxy) {
    this.#options.transport.off("desktopData", this.#onDesktopData);
    for (const stream of this.#streams.values()) stream.socket.close(1001, "Remote viewer stopped");
    this.#streams.clear();
    while (this.#operations.size)
      yield* Effect.forEach([...this.#operations], Deferred.await, { concurrency: "unbounded" });
    this.#webSockets.close();
    const server = this.#server;
    this.#server = null;
    this.#port = null;
    if (server)
      yield* Effect.callback<void>((resume) => {
        server.close(() => resume(Effect.void));
      });
  });

  #owned<A, E>(operation: Effect.Effect<A, E>): Effect.Effect<A, E> {
    return Effect.suspend(() => {
      const done = Deferred.makeUnsafe<void>();
      this.#operations.add(done);
      return operation.pipe(
        Effect.ensuring(
          Effect.sync(() => this.#operations.delete(done)).pipe(Effect.andThen(Deferred.succeed(done, undefined))),
        ),
      );
    });
  }

  readonly #start = Effect.fn("RemoteViewerProxy.start")(function* (this: RemoteViewerProxy) {
    if (this.#port) return this.#port;
    return yield* Effect.callback<number, RemoteWorkflowError>((resume) => {
      const resolve = (value: number) => resume(Effect.succeed(value));
      const reject = (cause: unknown) => resume(Effect.fail(new RemoteWorkflowError({ cause })));
      const server = createServer(
        (request, response) =>
          void Effect.runPromise(this.#owned(this.#handleHttp(request, response))).catch(() => undefined),
      );
      server.on("upgrade", (request, socket, head) => {
        const route = this.#route(request.url ?? "/");
        const tunneled =
          route &&
          (/^\/v1\/remote-screen\/sessions\/[A-Za-z0-9-]+\/stream$/u.test(route.upstreamPath) ||
            browserViewStreamSessionId(route.upstreamPath) !== null);
        if (!route || !tunneled) {
          socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
          socket.destroy();
          return;
        }
        this.#webSockets.handleUpgrade(request, socket, head, (webSocket) =>
          this.#openStream(route.serverId, route.upstreamPath, webSocket),
        );
      });
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || isString(address)) return reject(new Error(sourceText("error.remote.viewerProxyNoPort")));
        this.#server = server;
        this.#port = address.port;
        resolve(address.port);
      });
      return Effect.sync(() => {
        if (this.#server !== server) server.close();
      });
    });
  });

  readonly #handleHttp = Effect.fn("RemoteViewerProxy.handleHttp")(function* (
    this: RemoteViewerProxy,
    request: IncomingMessage,
    response: ServerResponse,
  ): Effect.fn.Return<void, RemoteWorkflowError> {
    const route = this.#route(request.url ?? "/");
    if (!route) return sendText(response, 404, "Not found");
    return yield* Effect.gen({ self: this }, function* () {
      const body =
        request.method === "GET" || request.method === "HEAD" ? undefined : yield* remoteCall(() => readBody(request));
      const upstream = yield* this.#options.fetchResource(route.serverId, route.upstreamPath, {
        method: request.method === "HEAD" ? "GET" : request.method,
        headers: { "Content-Type": request.headers["content-type"] ?? "application/octet-stream" },
        body: body ? Uint8Array.from(body).buffer : undefined,
      });
      if (upstream.status === 204) {
        response.writeHead(204, { "Cache-Control": "no-store" });
        response.end();
        return;
      }
      const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
      let bytes = new Uint8Array(yield* remoteCall(() => upstream.arrayBuffer()));
      if (contentType.includes("text/html") || contentType.includes("javascript")) {
        const prefix = this.#basePath(route.serverId);
        const escapedPrefix = prefix.replaceAll("/", "\\/");
        // Both forms of the namespace the viewer's assets reference: plain in URLs, backslash-escaped
        // where the bundle embeds it in a regex or a string literal.
        const namespace = TEAM_API_ROUTES.remoteScreen.prefix;
        const escapedNamespace = namespace.replaceAll("/", "\\/");
        const text = new TextDecoder()
          .decode(bytes)
          .replaceAll(escapedNamespace, `${escapedPrefix}${escapedNamespace}`)
          .replaceAll(namespace, `${prefix}${namespace}`);
        bytes = new TextEncoder().encode(text);
      }
      const responseHeaders: OutgoingHttpHeaders = {
        "Content-Type": contentType,
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      };
      if (contentType.includes("text/html")) {
        responseHeaders["Content-Security-Policy"] =
          "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; media-src 'self' blob:; worker-src 'self' blob:";
      }
      response.writeHead(upstream.status, responseHeaders);
      response.end(request.method === "HEAD" ? undefined : Buffer.from(bytes));
    }).pipe(
      Effect.catch(() =>
        Effect.sync(() => {
          sendText(response, 502, "Remote viewer resource unavailable");
        }),
      ),
    );
  });

  #openStream(serverId: string, upstreamPath: string, socket: Ws.WebSocket): void {
    const streamId = crypto.randomUUID();
    const stream: ViewerStream = {
      serverId,
      socket,
      opened: false,
      pending: [],
      pendingBytes: 0,
      forwardingBytes: 0,
      forwarding: Semaphore.makeUnsafe(1),
    };
    this.#streams.set(streamId, stream);
    socket.on("message", (data, binary) => {
      if (!stream.opened) {
        stream.pendingBytes += rawDataSize(data);
        if (stream.pendingBytes > MAX_PENDING_SIGNAL_BYTES) {
          socket.close(1009, "Remote desktop signal initialization is too large");
          return;
        }
        stream.pending.push({ data, binary });
        return;
      }
      this.#queueFrame(streamId, stream, data, binary);
    });
    socket.once("close", (code, reason) => {
      this.#streams.delete(streamId);
      void Effect.runPromise(
        this.#owned(
          this.#options.transport
            .sendDesktop(
              serverId,
              encodeRemoteDesktopSignalControl({ type: "close", streamId, code, reason: reason.toString() }),
            )
            .pipe(Effect.catch(() => Effect.void)),
        ),
      ).catch(() => undefined);
    });
    void Effect.runPromise(
      this.#owned(
        this.#options.transport
          .sendDesktop(serverId, encodeRemoteDesktopSignalControl({ type: "open", streamId, path: upstreamPath }))
          .pipe(Effect.catch(() => Effect.sync(() => socket.close(1011, "Remote desktop signal failed")))),
      ),
    ).catch(() => undefined);
  }

  readonly #sendFrameEffect = Effect.fn("RemoteViewerProxy.sendFrame")(function* (
    this: RemoteViewerProxy,
    streamId: string,
    stream: ViewerStream,
    data: Ws.RawData,
    binary: boolean,
  ): Effect.fn.Return<void, RemoteWorkflowError> {
    if (binary) {
      yield* this.#options.transport.sendDesktop(
        stream.serverId,
        encodeRemoteDesktopSignalBinary(streamId, rawDataBytes(data)),
      );
    } else {
      yield* this.#options.transport.sendDesktop(
        stream.serverId,
        encodeRemoteDesktopSignalControl({
          type: "text",
          streamId,
          data: rawDataText(data),
        }),
      );
    }
  });

  #queueFrame(streamId: string, stream: ViewerStream, data: Ws.RawData, binary: boolean): void {
    const bytes = rawDataSize(data);
    stream.forwardingBytes += bytes;
    if (stream.forwardingBytes > MAX_PENDING_SIGNAL_BYTES) {
      stream.forwardingBytes -= bytes;
      this.#streams.delete(streamId);
      stream.socket.close(1009, "Remote desktop signal queue is too large");
      return;
    }
    void Effect.runPromise(
      this.#owned(
        stream.forwarding.withPermit(
          Effect.gen({ self: this }, function* () {
            if (this.#streams.get(streamId) !== stream || stream.socket.readyState !== webSockets.WebSocket.OPEN)
              return;
            yield* this.#sendFrameEffect(streamId, stream, data, binary);
          }).pipe(
            Effect.catch(() =>
              Effect.sync(() => {
                if (this.#streams.get(streamId) === stream) {
                  this.#streams.delete(streamId);
                  stream.socket.close(1011, "Remote desktop signal failed");
                }
              }),
            ),
            Effect.ensuring(
              Effect.sync(() => {
                stream.forwardingBytes -= bytes;
              }),
            ),
          ),
        ),
      ),
    ).catch(() => undefined);
  }

  readonly #onDesktopData = (serverId: string, data: string | ArrayBuffer): void => {
    try {
      if (!isString(data)) {
        const frame = decodeRemoteDesktopSignalBinary(data);
        const stream = this.#streams.get(frame.streamId);
        if (stream?.serverId === serverId && stream.socket.readyState === webSockets.WebSocket.OPEN) {
          stream.socket.send(frame.bytes, { binary: true });
        }
        return;
      }
      const control = decodeRemoteDesktopSignalControl(data);
      const stream = this.#streams.get(control.streamId);
      if (!stream || stream.serverId !== serverId) return;
      if (control.type === "opened") {
        stream.opened = true;
        for (const frame of stream.pending.splice(0))
          this.#queueFrame(control.streamId, stream, frame.data, frame.binary);
        stream.pendingBytes = 0;
      } else if (control.type === "text" && stream.socket.readyState === webSockets.WebSocket.OPEN) {
        stream.socket.send(control.data);
      } else if (control.type === "close") {
        stream.socket.close(sendableCloseCode(control.code), control.reason);
      } else if (control.type === "error") {
        stream.socket.close(1011, control.message);
      }
    } catch {
      // A malformed optional desktop signal cannot affect Team API channels.
    }
  };

  #route(value: string): { serverId: string; upstreamPath: string } | null {
    try {
      const url = new URL(value, "http://127.0.0.1");
      const match = new RegExp(`^/${this.#token}/([^/]+)(/.*)$`, "u").exec(url.pathname);
      if (!match) return null;
      const serverId = decodeURIComponent(match[1] ?? "");
      if (!/^[A-Za-z0-9:_-]{1,128}$/u.test(serverId)) return null;
      return { serverId, upstreamPath: `${match[2]}${url.search}` };
    } catch {
      return null;
    }
  }

  #basePath(serverId: string): string {
    return `/${this.#token}/${encodeURIComponent(serverId)}`;
  }
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.byteLength;
    if (size > MAX_REQUEST_BYTES) throw new Error("Remote viewer request is too large.");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

function sendText(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
  response.end(body);
}
