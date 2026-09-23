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

export interface RemoteBrowserView {
  input(value: BrowserViewInput): Promise<void>;
  close(): Promise<void>;
}
interface View {
  streamId: string;
  sessionId: string;
  ready: boolean;
  frame: (frame: BrowserViewFrame) => void;
  ended: () => void;
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
  function disconnect() {
    generation += 1;
    const current = view;
    view = null;
    current?.ended();
  }
  async function close() {
    const current = view;
    disconnect();
    if (!current) return;
    try {
      await send(encodeRemoteDesktopSignalControl({ type: "close", streamId: current.streamId }));
    } finally {
      await request("DELETE", TEAM_API_ROUTES.browser.viewSession(current.sessionId));
    }
  }
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
            disconnect();
            void request("DELETE", TEAM_API_ROUTES.browser.viewSession(current.sessionId)).catch(() => undefined);
          }
        } else {
          const binary = decodeRemoteDesktopSignalBinary(data);
          if (binary.streamId === current.streamId && current.ready)
            current.frame(decodeBrowserViewFrame(binary.bytes));
        }
      } catch {
        void close().catch(() => undefined);
      }
    },
    async open(tabId: string, frame: (frame: BrowserViewFrame) => void, ended: () => void): Promise<RemoteBrowserView> {
      await close();
      const current = ++generation;
      const session = decodeBrowserViewSessionResponse(
        await request("POST", TEAM_API_ROUTES.browser.viewSessions, { tabId }),
      );
      if (current !== generation || session.tabId !== tabId) {
        await request("DELETE", TEAM_API_ROUTES.browser.viewSession(session.id));
        throw new Error("The browser view changed.");
      }
      const next: View = { sessionId: session.id, streamId: crypto.randomUUID(), ready: false, frame, ended };
      view = next;
      const acksFrames = namesFrames();
      // The host keeps a frame's size only for a client that will say when that frame is on screen.
      const path = new URL(session.streamPath, "http://host");
      if (acksFrames) path.searchParams.set(BROWSER_VIEW_FRAME_ACK_QUERY, "1");
      try {
        await send(
          encodeRemoteDesktopSignalControl({
            type: "open",
            streamId: next.streamId,
            path: path.pathname + path.search,
          }),
        );
      } catch (error) {
        await close().catch(() => undefined);
        throw error;
      }
      return {
        async input(input) {
          if (view !== next || !next.ready) throw new Error("The browser view is not connected.");
          const wire = browserViewInputForHost(input, acksFrames);
          if (!wire) return;
          await send(
            encodeRemoteDesktopSignalControl({
              type: "text",
              streamId: next.streamId,
              data: encodeBrowserViewInput(wire),
            }),
          );
        },
        async close() {
          if (view === next) await close();
        },
      };
    },
  };
}
