import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { Duplex } from "node:stream";
import {
  BROWSER_VIEW_MAX_CLIPBOARD_TEXT,
  BROWSER_VIEW_PAGE_COPY_AFTER_INPUT_MS,
  type BrowserViewContextMenu,
  type BrowserViewHostMessage,
  type BrowserViewSessionResponse,
  type BrowserViewViewport,
  browserViewClientAcksFrames,
  browserViewClientViewport,
  browserViewClientWantsContextMenu,
  browserViewClientWantsCursor,
  browserViewClientWantsPageCopy,
  browserViewStreamPath,
  browserViewStreamSessionId,
  decodeBrowserViewInput,
  encodeBrowserViewCopied,
  encodeBrowserViewFrame,
  encodeBrowserViewHostMessage,
  isBrowserViewUserAction,
} from "@openbot/contracts/team-protocol/browser-view-v1";
import { sourceText } from "@openbot/i18n/source";
import { redactText } from "@openbot/logging";
import { Context, Deferred, Effect, Layer, Result, Semaphore } from "effect";
import type * as Ws from "ws";
import type { BrowserScreencastFrame } from "../backend/browser-cdp";
import type { BrowserHost } from "../backend/browser-host";
import { recordRestartActivity } from "../backend/restart-activity";
import { RemoteWorkflowError, remoteDecode } from "./remote-service-effects";
import { rawDataSize, rawDataText } from "./ws-raw-data";

const requireModule = createRequire(import.meta.url);
const webSockets: typeof Ws = requireModule(join(dirname(requireModule.resolve("ws/package.json")), "index.js"));

const MAX_BUFFERED_FRAME_BYTES = 4 * 1024 * 1024;
const MAX_FRAMES_IN_FLIGHT = 4;
const HELD_FRAME_DEADLINE_MS = 1_000;
const MAX_UNACKNOWLEDGED_FRAMES = 120;
const MAX_ACK_MESSAGE_BYTES = 128;

function forgetFramesBefore(sizes: Map<number, { width: number; height: number }>, drawn: number): void {
  for (const sequence of sizes.keys()) {
    if (sequence < drawn) sizes.delete(sequence);
  }
}

function framesInFlight(session: Pick<ManagedViewSession, "frameSizes" | "drawnSequence">) {
  let count = 0;
  for (const sequence of session.frameSizes.keys()) {
    if (sequence > session.drawnSequence) count += 1;
  }
  return count;
}
const MAX_SESSIONS = 4;
const MAX_INPUT_MESSAGE_BYTES = 6 * BROWSER_VIEW_MAX_CLIPBOARD_TEXT + 4 * 1024;

export interface BrowserViewGatewayOptions {
  browser: Pick<BrowserHost, "startView" | "dispatchViewInput" | "copyViewSelection">;
  authenticate: (token: string) => { id: string } | null;
  onInput?: () => void;
  maxSessions?: number;
}

class BrowserViewPort extends Context.Service<
  BrowserViewPort,
  {
    start(
      ...args: Parameters<BrowserHost["startView"]>
    ): Effect.Effect<Effect.Success<ReturnType<BrowserHost["startView"]>>, RemoteWorkflowError>;
    input(...args: Parameters<BrowserHost["dispatchViewInput"]>): Effect.Effect<void, RemoteWorkflowError>;
    copy(...args: Parameters<BrowserHost["copyViewSelection"]>): Effect.Effect<string | null, RemoteWorkflowError>;
  }
>()("openbot/main/BrowserViewPort") {
  static layer(browser: BrowserViewGatewayOptions["browser"]) {
    return Layer.succeed(
      BrowserViewPort,
      BrowserViewPort.of({
        start: (...args) =>
          browser.startView(...args).pipe(Effect.mapError(({ cause }) => new RemoteWorkflowError({ cause }))),
        input: (...args) =>
          browser.dispatchViewInput(...args).pipe(Effect.mapError(({ cause }) => new RemoteWorkflowError({ cause }))),
        copy: (...args) =>
          browser.copyViewSelection(...args).pipe(Effect.mapError(({ cause }) => new RemoteWorkflowError({ cause }))),
      }),
    );
  }
}

type ViewInput = Parameters<BrowserHost["dispatchViewInput"]>[1];

interface ManagedViewSession {
  id: string;
  tabId: string;
  memberId: string;
  teamSessionId: string;
  socket: Ws.WebSocket | null;
  stopView: (() => Effect.Effect<void>) | null;
  frameWidth: number;
  frameHeight: number;
  frameSizes: Map<number, { width: number; height: number }>;
  rememberFrames: boolean;
  drawnSequence: number;
  heldFrame: BrowserScreencastFrame | null;
  heldFrameTimer: ReturnType<typeof setTimeout> | null;
  input: Semaphore.Semaphore;
  waiting: number;
  heldMove: ViewInput | null;
  views: Semaphore.Semaphore;
  reportCursor: boolean;
  reportContextMenu: boolean;
  viewport: BrowserViewViewport | null;
  reportPageCopy: boolean;
  lastActionAt: number;
}

export class BrowserViewGateway {
  readonly #options: BrowserViewGatewayOptions;
  readonly #layer: Layer.Layer<BrowserViewPort>;
  readonly #operations = new Set<Deferred.Deferred<void>>();
  #stopping: Deferred.Deferred<void, RemoteWorkflowError> | null = null;
  readonly #webSockets = new webSockets.WebSocketServer({ noServer: true });
  readonly #sessions = new Map<string, ManagedViewSession>();

  constructor(options: BrowserViewGatewayOptions) {
    this.#options = options;
    this.#layer = BrowserViewPort.layer(options.browser);
  }

  createSession(input: { memberId: string; teamSessionId: string; tabId: string }): BrowserViewSessionResponse {
    if (this.#sessions.size >= (this.#options.maxSessions ?? MAX_SESSIONS)) {
      throw new Error(sourceText("error.backend.browserViewLimit"));
    }
    const id = randomUUID().replaceAll("-", "");
    this.#sessions.set(id, {
      id,
      tabId: input.tabId,
      memberId: input.memberId,
      teamSessionId: input.teamSessionId,
      socket: null,
      stopView: null,
      frameWidth: 0,
      frameHeight: 0,
      frameSizes: new Map(),
      rememberFrames: false,
      drawnSequence: 0,
      heldFrame: null,
      heldFrameTimer: null,
      input: Semaphore.makeUnsafe(1),
      waiting: 0,
      heldMove: null,
      views: Semaphore.makeUnsafe(1),
      reportCursor: false,
      reportContextMenu: false,
      viewport: null,
      reportPageCopy: false,
      lastActionAt: 0,
    });
    return { id, tabId: input.tabId, streamPath: browserViewStreamPath(id) };
  }

  readonly closeMemberSession = Effect.fn("BrowserViewGateway.closeMemberSession")(
    function* (
      this: BrowserViewGateway,
      id: string,
      memberId: string,
    ): Effect.fn.Return<boolean, RemoteWorkflowError, BrowserViewPort> {
      const session = this.#sessions.get(id);
      if (!session || session.memberId !== memberId) return false;
      yield* this.#closeSession(session, "The browser view was closed.");
      return true;
    },
    (operation) => this.#provide(operation),
  ).bind(this);

  activeViewCount(): number {
    let count = 0;
    for (const session of this.#sessions.values()) {
      if (session.socket) count += 1;
    }
    return count;
  }

  readonly revokeTeamSession = Effect.fn("BrowserViewGateway.revokeTeamSession")(
    function* (
      this: BrowserViewGateway,
      teamSessionId: string,
    ): Effect.fn.Return<void, RemoteWorkflowError, BrowserViewPort> {
      for (const session of [...this.#sessions.values()]) {
        if (session.teamSessionId === teamSessionId) yield* this.#closeSession(session, "Team access ended.");
      }
    },
    (operation) => this.#provide(operation),
  ).bind(this);

  readonly closeRefusedSessions = Effect.fn("BrowserViewGateway.closeRefusedSessions")(
    function* (
      this: BrowserViewGateway,
      refused: (view: { memberId: string; tabId: string }) => boolean,
    ): Effect.fn.Return<void, RemoteWorkflowError, BrowserViewPort> {
      for (const session of [...this.#sessions.values()]) {
        if (refused(session)) yield* this.#closeSession(session, "Access to the agent ended.");
      }
    },
    (operation) => this.#provide(operation),
  ).bind(this);

  readonly stop = Effect.fn("BrowserViewGateway.stop")(function* (this: BrowserViewGateway) {
    if (this.#stopping) return yield* Deferred.await(this.#stopping);
    const stopped = Deferred.makeUnsafe<void, RemoteWorkflowError>();
    this.#stopping = stopped;
    return yield* Effect.gen({ self: this }, function* () {
      for (const session of [...this.#sessions.values()]) {
        yield* this.#closeSession(session, "The host stopped.");
      }
      while (this.#operations.size > 0) {
        yield* Effect.all([...this.#operations].map(Deferred.await), { concurrency: "unbounded" });
      }
    }).pipe(
      Effect.provide(this.#layer),
      Effect.onExit((exit) =>
        Effect.sync(() => {
          Deferred.doneUnsafe(stopped, exit);
          this.#stopping = null;
        }),
      ),
    );
  }, Effect.uninterruptible).bind(this);

  handlesUpgrade(url: URL): boolean {
    return browserViewStreamSessionId(url.pathname) !== null;
  }

  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer, url: URL): void {
    const sessionId = browserViewStreamSessionId(url.pathname);
    const session = sessionId ? this.#sessions.get(sessionId) : undefined;
    if (this.#stopping || !session || !this.#authorized(request, session)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    session.rememberFrames = browserViewClientAcksFrames(url);
    session.reportCursor = browserViewClientWantsCursor(url);
    session.reportContextMenu = browserViewClientWantsContextMenu(url);
    session.reportPageCopy = browserViewClientWantsPageCopy(url);
    session.viewport = browserViewClientViewport(url);
    this.#webSockets.handleUpgrade(request, socket, head, (client) => this.#dispatch(this.#connect(session, client)));
  }

  #authorized(request: IncomingMessage, session: ManagedViewSession): boolean {
    const remoteSession = request.headers["x-openbot-webrtc-session"];
    if (remoteSession === session.teamSessionId) return true;
    const protocols = (request.headers["sec-websocket-protocol"] ?? "").split(",").map((value) => value.trim());
    const encodedToken = protocols.find((value) => value.startsWith("openbot-token."));
    const token = encodedToken?.slice("openbot-token.".length) ?? "";
    if (!token || token.length > 512) return false;
    return this.#options.authenticate(token)?.id === session.memberId;
  }

  readonly #connect = Effect.fn("BrowserViewGateway.connect")(function* (
    this: BrowserViewGateway,
    session: ManagedViewSession,
    client: Ws.WebSocket,
  ): Effect.fn.Return<void, RemoteWorkflowError, BrowserViewPort> {
    if (session.socket) session.socket.close(1000, "The browser view moved to a new connection.");
    session.socket = client;
    session.frameWidth = 0;
    session.frameHeight = 0;
    session.frameSizes.clear();
    session.drawnSequence = 0;
    this.#forgetHeldFrame(session);
    recordRestartActivity();
    client.on("message", (data, binary) => {
      if (binary || session.socket !== client) return;
      this.#noteDrawnFrame(session, client, data);
      session.waiting += 1;
      this.#dispatch(
        session.input.withPermits(1)(
          Effect.suspend(() => {
            session.waiting -= 1;
            return this.#handleInput(session, data);
          }).pipe(Effect.ensuring(this.#sendHeldMove(session, false))),
        ),
      );
    });
    client.once("close", () => this.#dispatch(this.#detach(session, client)));
    client.once("error", () => this.#dispatch(this.#detach(session, client)));
    return yield* Effect.gen({ self: this }, function* () {
      const previousView = session.stopView;
      session.stopView = null;
      if (previousView) yield* previousView();
      if (session.socket !== client) return;
      const browser = yield* BrowserViewPort;
      const stopView = yield* browser.start(
        session.tabId,
        (frame) => {
          if (session.socket !== client) return;
          if (session.rememberFrames && framesInFlight(session) >= MAX_FRAMES_IN_FLIGHT) {
            this.#holdFrame(session, client, frame);
            return;
          }
          this.#forgetHeldFrame(session);
          if (!this.#sendFrame(session, client, frame) && session.rememberFrames)
            this.#holdFrame(session, client, frame);
        },
        (reason) => {
          this.#dispatch(this.#closeSession(session, reason));
        },
        {
          ...(session.reportCursor
            ? { onCursor: (cursor) => this.#send(session, client, { type: "cursor", cursor }) }
            : {}),
          ...(session.viewport ? { viewport: session.viewport } : {}),
          ...(session.reportPageCopy
            ? {
                onPageCopy: (text: string) => {
                  if (Date.now() - session.lastActionAt > BROWSER_VIEW_PAGE_COPY_AFTER_INPUT_MS) return;
                  if (text.length > 0 && text.length <= BROWSER_VIEW_MAX_CLIPBOARD_TEXT)
                    this.#send(session, client, { type: "pageCopied", text });
                },
              }
            : {}),
        },
      );
      if (session.socket === client) session.stopView = stopView;
      else yield* stopView();
    }).pipe(
      Effect.catch(({ cause: error }) =>
        Effect.gen({ self: this }, function* () {
          client.close(1011, redactText(String(error instanceof Error ? error.message : error)).slice(0, 120));
          yield* this.#detach(session, client);
        }),
      ),
      session.views.withPermits(1),
    );
  });

  readonly #handleInput = Effect.fn("BrowserViewGateway.handleInput")(function* (
    this: BrowserViewGateway,
    session: ManagedViewSession,
    data: Ws.RawData,
  ): Effect.fn.Return<void, RemoteWorkflowError, BrowserViewPort> {
    if (!session.socket) return;
    if (rawDataSize(data) > MAX_INPUT_MESSAGE_BYTES) return;

    const attempt1 = yield* remoteDecode(() => decodeBrowserViewInput(rawDataText(data))).pipe(Effect.result);
    if (Result.isFailure(attempt1)) {
      session.socket?.close(1008, "Invalid browser view input.");
      return;
    }
    const input = attempt1.success;
    if (input.type === "ack") {
      if (!session.frameSizes.has(input.sequence)) return;
      forgetFramesBefore(session.frameSizes, input.sequence);
      return;
    }
    this.#options.onInput?.();
    if (isBrowserViewUserAction(input)) session.lastActionAt = Date.now();
    if (input.type === "copy") {
      const client = session.socket;
      const browser = yield* BrowserViewPort;
      const text = yield* browser
        .copy(session.tabId, BROWSER_VIEW_MAX_CLIPBOARD_TEXT)
        .pipe(Effect.catch(() => Effect.succeed("")));
      if (session.socket !== client || client.readyState !== webSockets.WebSocket.OPEN) return;
      client.send(encodeBrowserViewCopied(text === null ? { type: "copyTooLarge" } : { type: "copied", text }));
      return;
    }
    let frame = { width: session.frameWidth, height: session.frameHeight };
    if (input.type === "pointer") {
      if (frame.width === 0 || frame.height === 0) return;
      if (input.sequence !== undefined) {
        const named = session.frameSizes.get(input.sequence);
        if (!named) return;
        frame = named;
        forgetFramesBefore(session.frameSizes, input.sequence);
      }
    }
    const dispatched =
      input.type === "pointer"
        ? { ...input, sequence: undefined, x: input.x * frame.width, y: input.y * frame.height }
        : input;
    if (dispatched.type === "pointer" && dispatched.action === "move") {
      session.heldMove = dispatched;
      return;
    }
    yield* this.#sendHeldMove(session, true);
    const browser = yield* BrowserViewPort;
    const client = session.socket;
    const onContextMenu =
      session.reportContextMenu && client
        ? (menu: BrowserViewContextMenu) => this.#send(session, client, { type: "context-menu", ...menu })
        : undefined;
    yield* browser.input(session.tabId, dispatched, onContextMenu).pipe(Effect.catch(() => Effect.void));
  });

  readonly #sendHeldMove = Effect.fn("BrowserViewGateway.sendHeldMove")(function* (
    this: BrowserViewGateway,
    session: ManagedViewSession,
    beforeInput: boolean,
  ): Effect.fn.Return<void, never, BrowserViewPort> {
    const move = session.heldMove;
    if (!move || (!beforeInput && session.waiting > 0)) return;
    session.heldMove = null;
    if (!session.socket) return;
    const browser = yield* BrowserViewPort;
    yield* browser.input(session.tabId, move).pipe(Effect.catch(() => Effect.void));
  });

  #sendFrame(session: ManagedViewSession, client: Ws.WebSocket, frame: BrowserScreencastFrame): boolean {
    if (session.socket !== client || client.readyState !== webSockets.WebSocket.OPEN) return false;
    if (client.bufferedAmount > MAX_BUFFERED_FRAME_BYTES) return false;
    client.send(encodeBrowserViewFrame(frame), { binary: true });
    session.frameWidth = frame.width;
    session.frameHeight = frame.height;
    if (session.rememberFrames) {
      session.frameSizes.set(frame.sequence, { width: frame.width, height: frame.height });
      if (session.frameSizes.size > MAX_UNACKNOWLEDGED_FRAMES) {
        this.#dispatch(this.#closeSession(session, "The live view fell too far behind."));
      }
    }
    return true;
  }

  #holdFrame(session: ManagedViewSession, client: Ws.WebSocket, frame: BrowserScreencastFrame): void {
    session.heldFrame = frame;
    if (session.heldFrameTimer) return;
    session.heldFrameTimer = setTimeout(() => {
      session.heldFrameTimer = null;
      this.#releaseHeldFrame(session, client, true);
    }, HELD_FRAME_DEADLINE_MS);
    session.heldFrameTimer.unref?.();
  }

  #releaseHeldFrame(session: ManagedViewSession, client: Ws.WebSocket, overdue: boolean): void {
    const held = session.heldFrame;
    if (!held || session.socket !== client) return;
    if (!overdue && framesInFlight(session) >= MAX_FRAMES_IN_FLIGHT) return;
    this.#forgetHeldFrame(session);
    if (!this.#sendFrame(session, client, held)) this.#holdFrame(session, client, held);
  }

  #forgetHeldFrame(session: ManagedViewSession): void {
    if (session.heldFrameTimer) clearTimeout(session.heldFrameTimer);
    session.heldFrameTimer = null;
    session.heldFrame = null;
  }

  #noteDrawnFrame(session: ManagedViewSession, client: Ws.WebSocket, data: Ws.RawData): void {
    if (!session.rememberFrames || rawDataSize(data) > MAX_ACK_MESSAGE_BYTES) return;
    let input: ReturnType<typeof decodeBrowserViewInput>;
    try {
      input = decodeBrowserViewInput(rawDataText(data));
    } catch {
      return;
    }
    if (input.type !== "ack" || !session.frameSizes.has(input.sequence)) return;
    session.drawnSequence = Math.max(session.drawnSequence, input.sequence);
    this.#releaseHeldFrame(session, client, false);
  }

  #send(session: ManagedViewSession, client: Ws.WebSocket, message: BrowserViewHostMessage): void {
    if (session.socket !== client || client.readyState !== webSockets.WebSocket.OPEN) return;
    client.send(encodeBrowserViewHostMessage(message));
  }

  readonly #detach = Effect.fn("BrowserViewGateway.detach")(function* (
    this: BrowserViewGateway,
    session: ManagedViewSession,
    client: Ws.WebSocket,
  ): Effect.fn.Return<void, RemoteWorkflowError, BrowserViewPort> {
    if (session.socket !== client) return;
    this.#sessions.delete(session.id);
    session.socket = null;
    this.#forgetHeldFrame(session);
    const stopView = session.stopView;
    session.stopView = null;
    if (stopView) yield* stopView().pipe(Effect.catch(() => Effect.void));
  });

  readonly #closeSession = Effect.fn("BrowserViewGateway.closeSession")(function* (
    this: BrowserViewGateway,
    session: ManagedViewSession,
    reason: string,
  ): Effect.fn.Return<void, RemoteWorkflowError, BrowserViewPort> {
    this.#sessions.delete(session.id);
    const client = session.socket;
    session.socket = null;
    this.#forgetHeldFrame(session);
    const stopView = session.stopView;
    session.stopView = null;
    client?.close(1000, reason.slice(0, 120));
    if (stopView) yield* stopView().pipe(Effect.catch(() => Effect.void));
  });
  #provide<A>(
    operation: Effect.Effect<A, RemoteWorkflowError, BrowserViewPort>,
  ): Effect.Effect<A, RemoteWorkflowError> {
    return Effect.suspend(() => {
      const completed = Deferred.makeUnsafe<void>();
      this.#operations.add(completed);
      return operation.pipe(
        Effect.provide(this.#layer),
        Effect.ensuring(
          Effect.sync(() => {
            this.#operations.delete(completed);
            Deferred.doneUnsafe(completed, Effect.void);
          }),
        ),
      );
    });
  }

  #dispatch(operation: Effect.Effect<void, RemoteWorkflowError, BrowserViewPort>): void {
    Effect.runFork(this.#provide(operation));
  }
}
