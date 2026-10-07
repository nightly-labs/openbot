import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import {
  BROWSER_VIEW_FRAME_ACK_QUERY,
  type BrowserViewFrame,
  type BrowserViewInput,
  browserViewInputForHost,
  decodeBrowserViewFrame,
  decodeBrowserViewSessionResponse,
  encodeBrowserViewInput,
} from "@openbot/contracts/team-protocol/browser-view-v1";
import {
  decodeRemoteDesktopSignalBinary,
  decodeRemoteDesktopSignalControl,
  encodeRemoteDesktopSignalControl,
} from "@openbot/contracts/team-protocol/remote-stream-v1";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result, Schema } from "effect";
import { runTeamEffect } from "./effect-boundary";

class BrowserViewError extends Schema.TaggedError<BrowserViewError>()("BrowserViewError", { message: Schema.String }) {}

function viewFailure(error: unknown): BrowserViewError {
  return new BrowserViewError({ message: error instanceof Error ? error.message : String(error) });
}

export interface RemoteBrowserView {
  input(value: BrowserViewInput): Effect.Effect<void, BrowserViewError>;
  close(): Effect.Effect<void, BrowserViewError>;
}
interface View {
  streamId: string;
  sessionId: string;
  ready: boolean;
  /** Set once the stream close and the session delete are sent, or the host ended the stream. */
  released: boolean;
  frame: (frame: BrowserViewFrame) => void;
  ended: (reason?: string) => void;
}
/** One browser tab view per client. All paths still pass the host's stream allowlist. */
export function createRemoteBrowserView(
  send: (data: string) => Promise<void>,
  request: (method: string, path: string, body?: { tabId: string }) => Promise<unknown>,
  /** Whether the host advertises `browser-view-frame-point`. An older host closes a view on an input it does not know. */
  namesFrames: () => boolean,
) {
  let view: View | null = null;
  let generation = 0;
  function disconnect(reason?: string) {
    generation += 1;
    const current = view;
    view = null;
    current?.ended(reason);
  }
  /**
   * Closes one view's stream and host session. A view can be detached before its handle closes it:
   * `disconnect()` during the open handshake leaves both open on the host.
   */
  const sendFrame = (data: string) => Effect.tryPromise({ try: () => send(data), catch: viewFailure });
  const requestHost = (method: string, path: string, body?: { tabId: string }) =>
    Effect.tryPromise({
      try: () => (body === undefined ? request(method, path) : request(method, path, body)),
      catch: viewFailure,
    });
  const release = Effect.fn("RemoteBrowserView.release")(function* (target: View) {
    if (target.released) return;
    target.released = true;
    // Deleting the session still runs when stream close fails or is interrupted.
    const closed = yield* Effect.acquireUseRelease(
      Effect.void,
      () => Effect.result(sendFrame(encodeRemoteDesktopSignalControl({ type: "close", streamId: target.streamId }))),
      () => requestHost("DELETE", TEAM_API_ROUTES.browser.viewSession(target.sessionId)).pipe(Effect.asVoid),
    );
    if (Result.isFailure(closed)) return yield* Effect.fail(closed.failure);
  });
  const close = Effect.fn("RemoteBrowserView.close")(function* () {
    const current = view;
    disconnect();
    if (current) yield* release(current);
  });
  const open = Effect.fn("RemoteBrowserView.open")(function* (
    tabId: string,
    frame: (frame: BrowserViewFrame) => void,
    ended: (reason?: string) => void,
  ): Effect.fn.Return<RemoteBrowserView, BrowserViewError> {
    yield* close().pipe(Effect.catch(() => Effect.void));
    const current = ++generation;
    const value = yield* requestHost("POST", TEAM_API_ROUTES.browser.viewSessions, { tabId });
    const session = yield* Effect.try({ try: () => decodeBrowserViewSessionResponse(value), catch: viewFailure });
    if (current !== generation || session.tabId !== tabId) {
      yield* requestHost("DELETE", TEAM_API_ROUTES.browser.viewSession(session.id));
      return yield* new BrowserViewError({ message: sourceText("error.remote.browserViewChanged") });
    }
    const next: View = {
      sessionId: session.id,
      streamId: crypto.randomUUID(),
      ready: false,
      released: false,
      frame,
      ended,
    };
    view = next;
    const acksFrames = namesFrames();
    const path = new URL(session.streamPath, "http://host");
    if (acksFrames) path.searchParams.set(BROWSER_VIEW_FRAME_ACK_QUERY, "1");
    yield* sendFrame(
      encodeRemoteDesktopSignalControl({
        type: "open",
        streamId: next.streamId,
        path: path.pathname + path.search,
      }),
    ).pipe(
      Effect.catch((error) => {
        if (view === next) disconnect();
        return release(next).pipe(
          Effect.catch(() => Effect.void),
          Effect.andThen(Effect.fail(error)),
        );
      }),
    );
    const input = Effect.fn("RemoteBrowserView.input")(function* (value: BrowserViewInput) {
      if (view !== next || !next.ready)
        return yield* new BrowserViewError({ message: sourceText("error.remote.browserViewNotConnected") });
      const wire = browserViewInputForHost(value, acksFrames);
      if (!wire) return;
      yield* sendFrame(
        encodeRemoteDesktopSignalControl({ type: "text", streamId: next.streamId, data: encodeBrowserViewInput(wire) }),
      );
    });
    return {
      input,
      close: Effect.fn("RemoteBrowserView.closeHandle")(function* () {
        if (view === next) disconnect();
        yield* release(next);
      }),
    };
  });
  return {
    disconnect,
    receive(data: string | ArrayBuffer) {
      const current = view;
      if (!current) return;
      try {
        if (typeof data === "string") {
          const control = decodeRemoteDesktopSignalControl(data);
          if (control.streamId !== current.streamId) return;
          if (control.type === "opened") current.ready = true;
          if (control.type === "close" || control.type === "error") {
            current.released = true;
            disconnect(
              control.type === "error"
                ? control.message || sourceText("error.backend.browserViewFailed")
                : control.reason ||
                    (control.code !== undefined && control.code !== 1000
                      ? sourceText("error.backend.browserViewFailed")
                      : undefined),
            );
            void runTeamEffect(requestHost("DELETE", TEAM_API_ROUTES.browser.viewSession(current.sessionId))).catch(
              () => undefined,
            );
          }
        } else {
          const binary = decodeRemoteDesktopSignalBinary(data);
          if (binary.streamId === current.streamId && current.ready)
            current.frame(decodeBrowserViewFrame(binary.bytes));
        }
      } catch {
        void runTeamEffect(close()).catch(() => undefined);
      }
    },
    open,
  };
}
