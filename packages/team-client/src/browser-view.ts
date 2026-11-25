import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import {
  BROWSER_VIEW_CONTEXT_MENU_QUERY,
  BROWSER_VIEW_CURSOR_QUERY,
  BROWSER_VIEW_DIALOG_QUERY,
  BROWSER_VIEW_FRAME_ACK_QUERY,
  BROWSER_VIEW_FRAME_SIZE_QUERY,
  BROWSER_VIEW_PAGE_COPY_AFTER_INPUT_MS,
  BROWSER_VIEW_PAGE_COPY_QUERY,
  BROWSER_VIEW_VIEWPORT_QUERY,
  type BrowserViewCopied,
  type BrowserViewFrame,
  type BrowserViewHostMessage,
  type BrowserViewInput,
  type BrowserViewViewport,
  browserViewFrameSizeQuery,
  browserViewInputForHost,
  browserViewViewportQuery,
  decodeBrowserViewFrame,
  decodeBrowserViewHostMessage,
  decodeBrowserViewSessionResponse,
  encodeBrowserViewInput,
  isBrowserViewUserAction,
} from "@openbot/contracts/team-protocol/browser-view-v1";
import {
  decodeRemoteDesktopSignalBinary,
  decodeRemoteDesktopSignalControl,
  encodeRemoteDesktopSignalControl,
} from "@openbot/contracts/team-protocol/remote-stream-v1";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result, Schema } from "effect";
import { runTeamEffect } from "./effect-boundary";
import { createTeamRequestId } from "./request-id";

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
  released: boolean;
  frame: (frame: BrowserViewFrame) => void;
  ended: (reason?: string) => void;
  copied: (message: BrowserViewCopied) => void;
  lastActionAt: number;
  message?: (message: Exclude<BrowserViewHostMessage, BrowserViewCopied>) => void;
}
export interface RemoteBrowserViewFeatures {
  cursor: boolean;
  contextMenu: boolean;
  viewport: BrowserViewViewport | null;
  pageCopy?: boolean;
  dialog?: boolean;
  frameSize?: BrowserViewViewport | null;
}
const NO_FEATURES: RemoteBrowserViewFeatures = { cursor: false, contextMenu: false, viewport: null };
export function createRemoteBrowserView(
  send: (data: string) => Promise<void>,
  request: (method: string, path: string, body?: { tabId: string }) => Promise<unknown>,
  namesFrames: () => boolean,
  clipboard: () => boolean,
  features: () => RemoteBrowserViewFeatures = () => NO_FEATURES,
) {
  let view: View | null = null;
  let generation = 0;
  function disconnect(reason?: string) {
    generation += 1;
    const current = view;
    view = null;
    current?.ended(reason);
  }
  const sendFrame = (data: string) => Effect.tryPromise({ try: () => send(data), catch: viewFailure });
  const requestHost = (method: string, path: string, body?: { tabId: string }) =>
    Effect.tryPromise({
      try: () => (body === undefined ? request(method, path) : request(method, path, body)),
      catch: viewFailure,
    });
  const release = Effect.fn("RemoteBrowserView.release")(function* (target: View) {
    if (target.released) return;
    target.released = true;
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
  const fail = Effect.fn("RemoteBrowserView.fail")(function* (target: View) {
    if (view === target) disconnect(sourceText("error.backend.browserViewFailed"));
    yield* release(target).pipe(Effect.catch(() => Effect.void));
  });
  const open = Effect.fn("RemoteBrowserView.open")(function* (
    tabId: string,
    frame: (frame: BrowserViewFrame) => void,
    ended: (reason?: string) => void,
    copied: (message: BrowserViewCopied) => void,
    message?: (message: Exclude<BrowserViewHostMessage, BrowserViewCopied>) => void,
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
      streamId: createTeamRequestId((size) => crypto.getRandomValues(new Uint8Array(size))),
      ready: false,
      released: false,
      frame,
      ended,
      copied,
      lastActionAt: 0,
      ...(message ? { message } : {}),
    };
    view = next;
    const acksFrames = namesFrames();
    const asked = features();
    const path = new URL(session.streamPath, "http://host");
    if (acksFrames) path.searchParams.set(BROWSER_VIEW_FRAME_ACK_QUERY, "1");
    if (asked.cursor && message) path.searchParams.set(BROWSER_VIEW_CURSOR_QUERY, "1");
    if (asked.contextMenu && message) path.searchParams.set(BROWSER_VIEW_CONTEXT_MENU_QUERY, "1");
    if (asked.pageCopy && message) path.searchParams.set(BROWSER_VIEW_PAGE_COPY_QUERY, "1");
    if (asked.dialog && message) path.searchParams.set(BROWSER_VIEW_DIALOG_QUERY, "1");
    if (asked.viewport) path.searchParams.set(BROWSER_VIEW_VIEWPORT_QUERY, browserViewViewportQuery(asked.viewport));
    if (asked.frameSize)
      path.searchParams.set(BROWSER_VIEW_FRAME_SIZE_QUERY, browserViewFrameSizeQuery(asked.frameSize));
    yield* sendFrame(
      encodeRemoteDesktopSignalControl({
        type: "open",
        streamId: next.streamId,
        path: path.pathname + path.search,
      }),
    ).pipe(
      Effect.catch(() => {
        return fail(next).pipe(
          Effect.andThen(Effect.fail(new BrowserViewError({ message: sourceText("error.backend.browserViewFailed") }))),
        );
      }),
    );
    const input = Effect.fn("RemoteBrowserView.input")(function* (value: BrowserViewInput) {
      if (view !== next || !next.ready)
        return yield* new BrowserViewError({ message: sourceText("error.remote.browserViewNotConnected") });
      const wire = browserViewInputForHost(value, acksFrames, clipboard());
      if (!wire) return;
      if (isBrowserViewUserAction(wire)) next.lastActionAt = Date.now();
      yield* sendFrame(
        encodeRemoteDesktopSignalControl({ type: "text", streamId: next.streamId, data: encodeBrowserViewInput(wire) }),
      ).pipe(
        Effect.catch(() =>
          fail(next).pipe(
            Effect.andThen(
              Effect.fail(new BrowserViewError({ message: sourceText("error.backend.browserViewFailed") })),
            ),
          ),
        ),
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
          if (control.type === "text" && current.ready) {
            const hostMessage = decodeBrowserViewHostMessage(control.data);
            if (hostMessage?.type === "copied" || hostMessage?.type === "copyTooLarge") current.copied(hostMessage);
            else if (
              hostMessage &&
              (hostMessage.type !== "pageCopied" ||
                Date.now() - current.lastActionAt <= BROWSER_VIEW_PAGE_COPY_AFTER_INPUT_MS)
            )
              current.message?.(hostMessage);
          }
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
        void runTeamEffect(fail(current)).catch(() => undefined);
      }
    },
    open,
  };
}
