import { randomBytes, timingSafeEqual } from "node:crypto";
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
import { readBodyWithin } from "./http-body";
import { LifecycleGate } from "./lifecycle-gate";
import { listenLoopback } from "./listen-loopback";
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
const VIEWER_FILE_PATH = new RegExp(
  `^${TEAM_API_ROUTES.remoteScreen.sessions}/[A-Za-z0-9-]+/moonlight(/[A-Za-z0-9_./-]+\\.(?:js|mjs|css|wasm|png|svg|ico|woff2?))$`,
  "u",
);
const HOST_WRITTEN_VIEWER_FILES = new Set(["/config.js", "/openbot-paste.js"]);
const MAX_KEPT_VIEWER_BYTES = 32 * 1024 * 1024;
const VIEWER_PAGE_POLICY =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; media-src 'self' blob:; worker-src 'self' blob:";

interface RemoteViewerTransport {
  sendDesktop(serverId: string, data: string | ArrayBuffer): Effect.Effect<void, RemoteWorkflowError>;
  on(event: "desktopData", listener: (serverId: string, data: string | ArrayBuffer) => void): unknown;
  on(event: "connected" | "disconnected", listener: (serverId: string) => void): unknown;
  off(event: "desktopData", listener: (serverId: string, data: string | ArrayBuffer) => void): unknown;
  off(event: "connected" | "disconnected", listener: (serverId: string) => void): unknown;
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

interface KeptViewerFiles {
  files: Map<string, { contentType: string; bytes: Uint8Array }>;
  bytes: number;
}

export class RemoteViewerProxy {
  readonly #options: RemoteViewerProxyOptions;
  readonly #operations = new Set<Deferred.Deferred<void>>();
  readonly #tokens = new Map<string, string>();
  readonly #webSockets = new webSockets.WebSocketServer({ noServer: true });
  readonly #streams = new Map<string, ViewerStream>();
  readonly #viewerFiles = new Map<string, KeptViewerFiles>();
  readonly #viewerFileEpochs = new Map<string, number>();
  #keepsViewerFiles = true;
  #server: Server | null = null;
  #port: number | null = null;
  readonly #lifecycle = new LifecycleGate<number, RemoteWorkflowError>();

  constructor(options: RemoteViewerProxyOptions) {
    this.#options = options;
    options.transport.on("desktopData", this.#onDesktopData);
    options.transport.on("disconnected", this.#onDisconnected);
    options.transport.on("connected", this.#forgetViewerFiles);
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
    this.#options.transport.off("disconnected", this.#onDisconnected);
    this.#options.transport.off("connected", this.#forgetViewerFiles);
    for (const stream of this.#streams.values()) stream.socket.close(1001, "Remote viewer stopped");
    this.#streams.clear();
    this.#keepsViewerFiles = false;
    this.#viewerFiles.clear();
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
      listenLoopback(server, () => new Error(sourceText("error.remote.viewerProxyNoPort"))).then((port) => {
        this.#server = server;
        this.#port = port;
        resolve(port);
      }, reject);
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
    if (!route?.upstreamPath.startsWith(`${TEAM_API_ROUTES.remoteScreen.prefix}/`)) {
      return sendText(response, 404, "Not found");
    }
    const viewerFile =
      request.method === "GET" || request.method === "HEAD" ? viewerFilePath(route.upstreamPath) : null;
    const keptFile = viewerFile === null ? undefined : this.#viewerFiles.get(route.serverId)?.files.get(viewerFile);
    if (keptFile) return sendViewerFile(response, request.method, 200, keptFile.contentType, keptFile.bytes);
    const epoch = this.#viewerFileEpochs.get(route.serverId) ?? 0;
    return yield* Effect.gen({ self: this }, function* () {
      const body =
        request.method === "GET" || request.method === "HEAD" ? undefined : yield* remoteCall(() => readBody(request));
      const method = request.method === "HEAD" ? "GET" : request.method;
      const upstream = yield* this.#options.fetchResource(route.serverId, route.upstreamPath, {
        ...(method === undefined ? {} : { method }),
        headers: { "Content-Type": request.headers["content-type"] ?? "application/octet-stream" },
        ...(body ? { body: Uint8Array.from(body).buffer } : {}),
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
        const namespace = TEAM_API_ROUTES.remoteScreen.prefix;
        const escapedNamespace = namespace.replaceAll("/", "\\/");
        const text = new TextDecoder()
          .decode(bytes)
          .replaceAll(escapedNamespace, `${escapedPrefix}${escapedNamespace}`)
          .replaceAll(namespace, `${prefix}${namespace}`);
        bytes = new TextEncoder().encode(text);
      }
      if (viewerFile !== null && upstream.status === 200)
        this.#keepViewerFile(route.serverId, epoch, viewerFile, contentType, bytes);
      sendViewerFile(response, request.method, upstream.status, contentType, bytes);
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
    socket.on("error", () => socket.close(1011));
    socket.once("close", (code, reason) => {
      if (!this.#streams.delete(streamId)) return;
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

  #keepViewerFile(serverId: string, epoch: number, path: string, contentType: string, bytes: Uint8Array): void {
    if (!this.#keepsViewerFiles || (this.#viewerFileEpochs.get(serverId) ?? 0) !== epoch) return;
    const kept = this.#viewerFiles.get(serverId) ?? { files: new Map(), bytes: 0 };
    if (kept.files.has(path) || kept.bytes + bytes.byteLength > MAX_KEPT_VIEWER_BYTES) return;
    kept.files.set(path, { contentType, bytes });
    kept.bytes += bytes.byteLength;
    this.#viewerFiles.set(serverId, kept);
  }

  readonly #forgetViewerFiles = (serverId: string): void => {
    this.#viewerFiles.delete(serverId);
    this.#viewerFileEpochs.set(serverId, (this.#viewerFileEpochs.get(serverId) ?? 0) + 1);
  };

  readonly #onDisconnected = (serverId: string): void => {
    this.#forgetViewerFiles(serverId);
    for (const [streamId, stream] of this.#streams) {
      if (stream.serverId !== serverId) continue;
      this.#streams.delete(streamId);
      stream.socket.close(1011, sourceText("error.remote.hostDisconnected"));
    }
  };

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
    } catch {}
  };

  #route(value: string): { serverId: string; upstreamPath: string } | null {
    try {
      const url = new URL(value, "http://127.0.0.1");
      const match = /^\/([0-9a-f]{32})\/([^/]+)(\/.*)$/u.exec(url.pathname);
      if (!match) return null;
      const serverId = decodeURIComponent(match[2] ?? "");
      if (!/^[A-Za-z0-9:_-]{1,128}$/u.test(serverId)) return null;
      const expected = this.#tokens.get(serverId);
      const given = Buffer.from(match[1] ?? "");
      if (expected === undefined || !timingSafeEqual(given, Buffer.from(expected))) return null;
      return { serverId, upstreamPath: `${match[3]}${url.search}` };
    } catch {
      return null;
    }
  }

  #basePath(serverId: string): string {
    let token = this.#tokens.get(serverId);
    if (token === undefined) {
      token = randomBytes(16).toString("hex");
      this.#tokens.set(serverId, token);
    }
    return `/${token}/${encodeURIComponent(serverId)}`;
  }
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const body = await readBodyWithin(request, MAX_REQUEST_BYTES);
  if (body === null) throw new Error("Remote viewer request is too large.");
  return body;
}

function viewerFilePath(upstreamPath: string): string | null {
  const path = VIEWER_FILE_PATH.exec(upstreamPath)?.[1];
  return path === undefined || path.includes("..") || HOST_WRITTEN_VIEWER_FILES.has(path) ? null : path;
}

function sendViewerFile(
  response: ServerResponse,
  method: string | undefined,
  status: number,
  contentType: string,
  bytes: Uint8Array,
): void {
  const headers: OutgoingHttpHeaders = {
    "Content-Type": contentType,
    "Content-Length": String(bytes.byteLength),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (contentType.includes("text/html")) headers["Content-Security-Policy"] = VIEWER_PAGE_POLICY;
  response.writeHead(status, headers);
  response.end(method === "HEAD" ? undefined : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
}

function sendText(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
  response.end(body);
}
