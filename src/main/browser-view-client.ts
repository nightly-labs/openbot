// The client's side of the live browser view: one socket at a time, onto one tab of one host.
//
// The renderer asks for a tab, not for a session: which host it is, whether that host is reachable
// on the network or only through the WebRTC tunnel, and which session the frames belong to are all
// answered here. Starting a second view replaces the first, because a user looks at one tab.

import type { BrowserLiveViewEvent } from "@openbot/contracts/ipc";
import {
  BROWSER_VIEW_FRAME_ACK_QUERY,
  type BrowserViewInput,
  browserViewInputForHost,
  decodeBrowserViewFrame,
  encodeBrowserViewInput,
  TEAM_BROWSER_VIEW_CAPABILITY,
  TEAM_BROWSER_VIEW_FRAME_POINT_CAPABILITY,
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
  onEvent: (event: BrowserLiveViewEvent) => void;
}

interface ActiveView {
  serverId: string;
  sessionId: string;
  tabId: string;
  socket: WebSocket;
}

export class BrowserViewClient {
  readonly #options: BrowserViewClientOptions;
  #view: ActiveView | null = null;
  /** Start and stop both replace the view, so they run one after another rather than at once. */
  #chain: Deferred.Deferred<void> | null = null;
  readonly #events = new Set<Fiber.Fiber<void>>();

  constructor(options: BrowserViewClientOptions) {
    this.#options = options;
  }

  readonly start = Effect.fn("BrowserViewClient.start")(
    function* (this: BrowserViewClient, tabId: string) {
      const serverId = this.#options.servers.activeServerId;
      if (!serverId)
        return yield* new RemoteWorkflowError({ cause: new Error(sourceText("error.backend.browserViewRemoteOnly")) });
      if (!this.#options.servers.supportsCapability(serverId, TEAM_BROWSER_VIEW_CAPABILITY)) {
        return yield* new RemoteWorkflowError({ cause: new Error(sourceText("error.backend.browserViewUnsupported")) });
      }
      yield* this.#closeViewEffect();
      const stream = yield* this.#options.servers.openBrowserViewStream(serverId, tabId);
      const url = new URL(stream.url);
      // The host keeps a frame's size only for a client that will say when that frame is on screen.
      // An older client never does, and the host must not retain every frame for the whole session.
      if (this.#options.servers.supportsCapability(serverId, TEAM_BROWSER_VIEW_FRAME_POINT_CAPABILITY)) {
        url.searchParams.set(BROWSER_VIEW_FRAME_ACK_QUERY, "1");
      }
      const socket = yield* remoteDecode(() => new WebSocket(url, stream.protocols));
      socket.binaryType = "arraybuffer";
      const view: ActiveView = { serverId, sessionId: stream.sessionId, tabId, socket };
      this.#view = view;
      socket.addEventListener("message", (message) => {
        if (this.#view !== view || typeof message.data === "string") return;
        try {
          const frame = decodeBrowserViewFrame(new Uint8Array(message.data));
          this.#options.onEvent({ type: "frame", tabId, ...frame });
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

  readonly stop = Effect.fn("BrowserViewClient.stop")(() =>
    this.#queue(
      Effect.gen({ self: this }, function* () {
        yield* this.#closeViewEffect();
        yield* Fiber.awaitAll([...this.#events]);
      }),
    ),
  );

  /**
   * Input is dropped rather than queued when no view is open: a click belongs to the frame the user
   * was looking at, and the next view shows a different page.
   */
  sendInput(input: BrowserViewInput): void {
    const view = this.#view;
    if (!view || view.socket.readyState !== WebSocket.OPEN) return;
    // An older host drops an unknown sequence and would expand the point with a newer frame.
    const namesFrames = this.#options.servers.supportsCapability(
      view.serverId,
      TEAM_BROWSER_VIEW_FRAME_POINT_CAPABILITY,
    );
    const wire = browserViewInputForHost(input, namesFrames);
    if (!wire) return;
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
    this.#options.onEvent({ type: "stopped", tabId: view.tabId, reason });
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
