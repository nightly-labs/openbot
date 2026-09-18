// The client's side of the live browser view: one socket at a time, onto one tab of one host.
//
// The renderer asks for a tab, not for a session: which host it is, whether that host is reachable
// on the network or only through the WebRTC tunnel, and which session the frames belong to are all
// answered here. Starting a second view replaces the first, because a user looks at one tab.

import type { BrowserLiveViewEvent, BrowserLiveViewInput } from "@openbot/contracts/ipc";
import {
  decodeBrowserViewFrame,
  decodeBrowserViewInputValue,
  encodeBrowserViewInput,
  TEAM_BROWSER_VIEW_CAPABILITY,
} from "@openbot/contracts/team-protocol/browser-view-v1";
import type { RemoteServerManager } from "./remote-server-manager";

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
  #chain: Promise<void> = Promise.resolve();

  constructor(options: BrowserViewClientOptions) {
    this.#options = options;
  }

  async start(tabId: string): Promise<void> {
    return this.#queue(async () => {
      const serverId = this.#options.servers.activeServerId;
      if (!serverId) throw new Error("A live browser view is only for a remote host.");
      if (!this.#options.servers.supportsCapability(serverId, TEAM_BROWSER_VIEW_CAPABILITY)) {
        throw new Error("This remote host does not support a live browser view.");
      }
      await this.#closeView();
      const stream = await this.#options.servers.openBrowserViewStream(serverId, tabId);
      const socket = new WebSocket(stream.url, stream.protocols);
      socket.binaryType = "arraybuffer";
      const view: ActiveView = { serverId, sessionId: stream.sessionId, tabId, socket };
      this.#view = view;
      socket.addEventListener("message", (message) => {
        if (this.#view !== view || typeof message.data === "string") return;
        try {
          const frame = decodeBrowserViewFrame(new Uint8Array(message.data));
          this.#options.onEvent({ type: "frame", tabId, ...frame });
        } catch {
          socket.close(1003, "Invalid browser view frame");
        }
      });
      socket.addEventListener("close", () => this.#viewEnded(view, "The live view of this page ended."));
      socket.addEventListener("error", () => this.#viewEnded(view, "The live view of this page failed."));
    });
  }

  async stop(): Promise<void> {
    return this.#queue(() => this.#closeView());
  }

  /**
   * Input is dropped rather than queued when no view is open: a click belongs to the frame the user
   * was looking at, and the next view shows a different page.
   */
  sendInput(input: BrowserLiveViewInput): void {
    const view = this.#view;
    if (!view || view.socket.readyState !== WebSocket.OPEN) return;
    view.socket.send(encodeBrowserViewInput(decodeBrowserViewInputValue(input)));
  }

  #queue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#chain.then(operation);
    this.#chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  #viewEnded(view: ActiveView, reason: string): void {
    if (this.#view !== view) return;
    this.#view = null;
    void this.#options.servers.closeBrowserViewSession(view.serverId, view.sessionId).catch(() => undefined);
    this.#options.onEvent({ type: "stopped", tabId: view.tabId, reason });
  }

  async #closeView(): Promise<void> {
    const view = this.#view;
    if (!view) return;
    this.#view = null;
    view.socket.close(1000, "The live view was closed");
    await this.#options.servers.closeBrowserViewSession(view.serverId, view.sessionId).catch(() => undefined);
  }
}
