import type { BrowserLiveViewEvent } from "@openbot/contracts/ipc";
import {
  BROWSER_VIEW_DIALOG_QUERY,
  BROWSER_VIEW_FRAME_ACK_QUERY,
  BROWSER_VIEW_PAGE_COPY_AFTER_INPUT_MS,
  BROWSER_VIEW_PAGE_COPY_QUERY,
  type BrowserViewInput,
  browserViewInputForHost,
  decodeBrowserViewFrame,
  decodeBrowserViewHostMessage,
  encodeBrowserViewInput,
  isBrowserViewUserAction,
  TEAM_BROWSER_VIEW_CAPABILITY,
  TEAM_BROWSER_VIEW_CLIPBOARD_CAPABILITY,
  TEAM_BROWSER_VIEW_DIALOG_CAPABILITY,
  TEAM_BROWSER_VIEW_FRAME_POINT_CAPABILITY,
  TEAM_BROWSER_VIEW_PAGE_COPY_CAPABILITY,
} from "@openbot/contracts/team-protocol/browser-view-v1";
import { sourceText } from "@openbot/i18n/source";
import { Deferred, Effect, Fiber } from "effect";
import type { RemoteServerManager } from "./remote-server-manager";
import { RemoteWorkflowError, remoteDecode } from "./remote-service-effects";

export interface BrowserViewClientOptions {
  servers: Pick<
    RemoteServerManager,
    "activeServerId" | "supportsCapability" | "openBrowserViewStream" | "closeBrowserViewSession"
  >;
  onEvent: (event: BrowserLiveViewEvent, owner: number) => void;
  writeClipboard: (text: string) => void;
}

interface ActiveView {
  serverId: string;
  sessionId: string;
  tabId: string;
  owner: number;
  socket: WebSocket;
  lastActionAt: number;
}

export class BrowserViewClient {
  readonly #options: BrowserViewClientOptions;
  #view: ActiveView | null = null;
  #chain: Deferred.Deferred<void> | null = null;
  readonly #events = new Set<Fiber.Fiber<void>>();

  constructor(options: BrowserViewClientOptions) {
    this.#options = options;
  }

  readonly start = Effect.fn("BrowserViewClient.start")(
    function* (this: BrowserViewClient, tabId: string, owner: number) {
      const serverId = this.#options.servers.activeServerId;
      if (!serverId)
        return yield* new RemoteWorkflowError({ cause: new Error(sourceText("error.backend.browserViewRemoteOnly")) });
      if (!this.#options.servers.supportsCapability(serverId, TEAM_BROWSER_VIEW_CAPABILITY)) {
        return yield* new RemoteWorkflowError({ cause: new Error(sourceText("error.backend.browserViewUnsupported")) });
      }
      yield* this.#closeViewEffect();
      const stream = yield* this.#options.servers.openBrowserViewStream(serverId, tabId);
      const url = new URL(stream.url);
      if (this.#options.servers.supportsCapability(serverId, TEAM_BROWSER_VIEW_FRAME_POINT_CAPABILITY)) {
        url.searchParams.set(BROWSER_VIEW_FRAME_ACK_QUERY, "1");
      }
      if (this.#options.servers.supportsCapability(serverId, TEAM_BROWSER_VIEW_PAGE_COPY_CAPABILITY)) {
        url.searchParams.set(BROWSER_VIEW_PAGE_COPY_QUERY, "1");
      }
      if (this.#options.servers.supportsCapability(serverId, TEAM_BROWSER_VIEW_DIALOG_CAPABILITY)) {
        url.searchParams.set(BROWSER_VIEW_DIALOG_QUERY, "1");
      }
      const socket = yield* remoteDecode(() => new WebSocket(url, stream.protocols));
      socket.binaryType = "arraybuffer";
      const view: ActiveView = { serverId, sessionId: stream.sessionId, tabId, owner, socket, lastActionAt: 0 };
      this.#view = view;
      socket.addEventListener("message", (message) => {
        if (this.#view !== view) return;
        if (typeof message.data === "string") {
          try {
            const hostMessage = decodeBrowserViewHostMessage(message.data);
            if (
              hostMessage?.type === "copied" ||
              hostMessage?.type === "copyTooLarge" ||
              hostMessage?.type === "dialog"
            )
              this.#options.onEvent({ ...hostMessage, tabId }, owner);
            else if (hostMessage?.type === "pageCopied") {
              if (Date.now() - view.lastActionAt <= BROWSER_VIEW_PAGE_COPY_AFTER_INPUT_MS)
                this.#options.writeClipboard(hostMessage.text);
            } else throw new Error("Invalid browser view message.");
          } catch {
            socket.close(1000, "Invalid browser view message");
          }
          return;
        }
        try {
          const frame = decodeBrowserViewFrame(new Uint8Array(message.data));
          this.#options.onEvent({ type: "frame", tabId, ...frame }, owner);
        } catch {
          socket.close(1000, "Invalid browser view frame");
        }
      });
      const ended = (reason: string) => {
        const fiber = Effect.runFork(this.#viewEnded(view, reason));
        this.#events.add(fiber);
        fiber.addObserver(() => this.#events.delete(fiber));
      };
      socket.addEventListener("close", (event) =>
        ended(
          event.reason ||
            (event.code === 1000
              ? sourceText("error.backend.browserViewEnded")
              : sourceText("error.backend.browserViewFailed")),
        ),
      );
      socket.addEventListener("error", () => ended(sourceText("error.backend.browserViewFailed")));
    },
    (operation) => this.#queue(operation),
  ).bind(this);

  readonly stop = Effect.fn("BrowserViewClient.stop")((owner?: number) =>
    this.#queue(
      Effect.gen({ self: this }, function* () {
        if (owner !== undefined && this.#view?.owner !== owner) return;
        yield* this.#closeViewEffect();
        yield* Fiber.awaitAll([...this.#events]);
      }),
    ),
  );

  sendInput(input: BrowserViewInput): void {
    const view = this.#view;
    if (!view || view.socket.readyState !== WebSocket.OPEN) return;
    const namesFrames = this.#options.servers.supportsCapability(
      view.serverId,
      TEAM_BROWSER_VIEW_FRAME_POINT_CAPABILITY,
    );
    const clipboard = this.#options.servers.supportsCapability(view.serverId, TEAM_BROWSER_VIEW_CLIPBOARD_CAPABILITY);
    const wire = browserViewInputForHost(input, namesFrames, clipboard);
    if (!wire) return;
    if (isBrowserViewUserAction(wire)) view.lastActionAt = Date.now();
    view.socket.send(encodeBrowserViewInput(wire));
  }

  #queue<T>(operation: Effect.Effect<T, RemoteWorkflowError>): Effect.Effect<T, RemoteWorkflowError> {
    return Effect.gen({ self: this }, function* () {
      const previous = this.#chain;
      const pending = Deferred.makeUnsafe<void>();
      this.#chain = pending;
      return yield* Effect.gen(function* () {
        if (previous) yield* Deferred.await(previous);
        return yield* operation;
      }).pipe(
        Effect.ensuring(
          Effect.gen({ self: this }, function* () {
            if (this.#chain === pending) this.#chain = null;
            yield* Deferred.succeed(pending, undefined);
          }),
        ),
      );
    }).pipe(Effect.uninterruptible);
  }

  readonly #viewEnded = Effect.fn("BrowserViewClient.viewEnded")(function* (
    this: BrowserViewClient,
    view: ActiveView,
    reason: string,
  ) {
    if (this.#view !== view) return;
    this.#view = null;
    this.#options.onEvent({ type: "stopped", tabId: view.tabId, reason }, view.owner);
    yield* this.#releaseEffect(view);
  });

  readonly #closeViewEffect = Effect.fn("BrowserViewClient.closeView")(function* (this: BrowserViewClient) {
    const view = this.#view;
    if (!view) return;
    this.#view = null;
    view.socket.close(1000, "The live view was closed");
    yield* this.#releaseEffect(view);
  });

  readonly #releaseEffect = Effect.fn("BrowserViewClient.release")((view: ActiveView) =>
    this.#options.servers.closeBrowserViewSession(view.serverId, view.sessionId).pipe(Effect.catch(() => Effect.void)),
  );
}
