import { recordRestartActivity } from "../backend/restart-activity";
// The host's side of the live browser view: a session a member asks for, a socket that carries the
// frames, and the pointer and key input that comes back on it.
//
// It is a gateway rather than a route because a route answers once and this does not: the frames go
// on for as long as the member watches. The shape follows `remote-screen-gateway.ts`, including how
// the socket is authorized -- a tunneled socket arrives with the WebRTC session header and no token,
// because the host itself opened it on the member's behalf.

import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { Duplex } from "node:stream";
import {
  type BrowserViewSessionResponse,
  browserViewClientAcksFrames,
  browserViewStreamPath,
  browserViewStreamSessionId,
  decodeBrowserViewInput,
  encodeBrowserViewFrame,
} from "@openbot/contracts/team-protocol/browser-view-v1";
import type * as Ws from "ws";
import type { BrowserHost } from "../backend/browser-host";
import { rawDataSize, rawDataText } from "./ws-raw-data";

const requireModule = createRequire(import.meta.url);
const webSockets: typeof Ws = requireModule(join(dirname(requireModule.resolve("ws/package.json")), "index.js"));

/**
 * How many frames may wait in the socket before the next one is dropped. A live view that falls
 * behind must show the page as it is now, not replay the seconds the link was slow.
 */
const MAX_BUFFERED_FRAME_BYTES = 4 * 1024 * 1024;
/**
 * Frames kept after the one the client has drawn. A client that asked to name frames and then
 * stops saying which one is on screen would otherwise keep one entry per frame for the whole
 * view. Past this the view is closed. The drawn frame is not dropped in place: that is what made
 * a click land on the wrong page.
 */
const MAX_UNACKNOWLEDGED_FRAMES = 120;

/** Frames older than the one on the member's screen. The named frame itself stays, so a click on it still expands. */
function forgetFramesBefore(sizes: Map<number, { width: number; height: number }>, drawn: number): void {
  for (const sequence of sizes.keys()) {
    if (sequence < drawn) sizes.delete(sequence);
  }
}
const MAX_SESSIONS = 4;
const MAX_INPUT_MESSAGE_BYTES = 4 * 1024;

export interface BrowserViewGatewayOptions {
  browser: Pick<BrowserHost, "startView" | "dispatchViewInput">;
  /** Answers the member a direct socket's token belongs to, for a client that is not tunneled. */
  authenticate: (token: string) => { id: string } | null;
  maxSessions?: number;
}

interface ManagedViewSession {
  id: string;
  tabId: string;
  memberId: string;
  teamSessionId: string;
  socket: Ws.WebSocket | null;
  stopView: (() => Promise<void>) | null;
  /** The size of the last frame sent, which is what a fractional input coordinate refers to. */
  frameWidth: number;
  frameHeight: number;
  /**
   * The shape of each frame this session sent and the client may still be drawing, by sequence.
   * Only a client that acknowledged frames at connect fills this. An older client names no frame,
   * so there is nothing to look up, and keeping one entry per frame would grow for the whole view.
   */
  frameSizes: Map<number, { width: number; height: number }>;
  rememberFrames: boolean;
}

export class BrowserViewGateway {
  readonly #options: BrowserViewGatewayOptions;
  readonly #webSockets = new webSockets.WebSocketServer({ noServer: true });
  readonly #sessions = new Map<string, ManagedViewSession>();

  constructor(options: BrowserViewGatewayOptions) {
    this.#options = options;
  }

  createSession(input: { memberId: string; teamSessionId: string; tabId: string }): BrowserViewSessionResponse {
    if (this.#sessions.size >= (this.#options.maxSessions ?? MAX_SESSIONS)) {
      throw new Error("Too many browser views are open on this host.");
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
    });
    return { id, tabId: input.tabId, streamPath: browserViewStreamPath(id) };
  }

  async closeMemberSession(id: string, memberId: string): Promise<boolean> {
    const session = this.#sessions.get(id);
    if (!session || session.memberId !== memberId) return false;
    await this.#closeSession(session, "The browser view was closed.");
    return true;
  }

  /** Views with a live socket. Created but never opened views do not hold anything. */
  activeViewCount(): number {
    let count = 0;
    for (const session of this.#sessions.values()) {
      if (session.socket) count += 1;
    }
    return count;
  }

  async revokeTeamSession(teamSessionId: string): Promise<void> {
    for (const session of [...this.#sessions.values()]) {
      if (session.teamSessionId === teamSessionId) await this.#closeSession(session, "Team access ended.");
    }
  }

  async stop(): Promise<void> {
    for (const session of [...this.#sessions.values()]) await this.#closeSession(session, "The host stopped.");
    this.#webSockets.close();
  }

  handlesUpgrade(url: URL): boolean {
    return browserViewStreamSessionId(url.pathname) !== null;
  }

  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer, url: URL): void {
    const sessionId = browserViewStreamSessionId(url.pathname);
    const session = sessionId ? this.#sessions.get(sessionId) : undefined;
    if (!session || !this.#authorized(request, session)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    // A new socket is a new stream. Sizes from the previous one name frames this client never saw.
    session.frameWidth = 0;
    session.frameHeight = 0;
    session.frameSizes.clear();
    session.rememberFrames = browserViewClientAcksFrames(url);
    this.#webSockets.handleUpgrade(request, socket, head, (client) => void this.#connect(session, client));
  }

  /**
   * A tunneled socket carries the WebRTC session this host opened it for and no token: the member
   * never reaches this port themselves. A direct socket carries the member's token, and it has to be
   * the member the session was made for -- another member's token opens their own view, not this one.
   */
  #authorized(request: IncomingMessage, session: ManagedViewSession): boolean {
    const remoteSession = request.headers["x-openbot-webrtc-session"];
    if (remoteSession === session.teamSessionId) return true;
    const protocols = (request.headers["sec-websocket-protocol"] ?? "").split(",").map((value) => value.trim());
    const encodedToken = protocols.find((value) => value.startsWith("openbot-token."));
    const token = encodedToken?.slice("openbot-token.".length) ?? "";
    if (!token || token.length > 512) return false;
    return this.#options.authenticate(token)?.id === session.memberId;
  }

  async #connect(session: ManagedViewSession, client: Ws.WebSocket): Promise<void> {
    if (session.socket) session.socket.close(1000, "The browser view moved to a new connection.");
    session.socket = client;
    recordRestartActivity();
    client.on("message", (data, binary) => {
      if (binary || session.socket !== client) return;
      void this.#handleInput(session, data);
    });
    client.once("close", () => void this.#detach(session, client));
    client.once("error", () => void this.#detach(session, client));
    try {
      const stopView = await this.#options.browser.startView(
        session.tabId,
        (frame) => {
          if (session.socket !== client || client.readyState !== webSockets.WebSocket.OPEN) return;
          // A dropped frame is one the client never sees, so it cannot be the frame a fraction is a
          // fraction of. Recording its shape here would expand the client's next point with a size
          // only this side knows about, and the click would land somewhere the user never pointed.
          if (client.bufferedAmount > MAX_BUFFERED_FRAME_BYTES) return;
          client.send(encodeBrowserViewFrame(frame), { binary: true });
          session.frameWidth = frame.width;
          session.frameHeight = frame.height;
          if (session.rememberFrames) {
            session.frameSizes.set(frame.sequence, { width: frame.width, height: frame.height });
            if (session.frameSizes.size > MAX_UNACKNOWLEDGED_FRAMES) {
              void this.#closeSession(session, "The live view fell too far behind.");
            }
          }
        },
        (reason) => {
          void this.#closeSession(session, reason);
        },
      );
      if (session.socket === client) session.stopView = stopView;
      else await stopView();
    } catch (error) {
      client.close(1011, String(error instanceof Error ? error.message : error).slice(0, 120));
      await this.#detach(session, client);
    }
  }

  async #handleInput(session: ManagedViewSession, data: Ws.RawData): Promise<void> {
    if (rawDataSize(data) > MAX_INPUT_MESSAGE_BYTES) return;
    let input: ReturnType<typeof decodeBrowserViewInput>;
    try {
      input = decodeBrowserViewInput(rawDataText(data));
    } catch {
      session.socket?.close(1008, "Invalid browser view input.");
      return;
    }
    // The client has drawn this frame. Older ones are no longer on screen, including when the
    // member never moves the pointer. A frame this session did not send is not a frame to trust.
    if (input.type === "ack") {
      if (!session.frameSizes.has(input.sequence)) return;
      forgetFramesBefore(session.frameSizes, input.sequence);
      return;
    }
    // Input that arrives before the first frame has no frame to be a fraction of.
    let frame = { width: session.frameWidth, height: session.frameHeight };
    if (input.type === "pointer") {
      if (frame.width === 0 || frame.height === 0) return;
      // A client from before the sequence field names no frame and gets the newest one: that is
      // what every client got before a point could name its own. A named frame this session did
      // not send, or one the client has already moved past, is not that client. Expanding it with
      // a newer size clicks a page the user was not looking at, so the point is dropped.
      if (input.sequence !== undefined) {
        const named = session.frameSizes.get(input.sequence);
        if (!named) return;
        frame = named;
        forgetFramesBefore(session.frameSizes, input.sequence);
      }
    }
    // The sequence names a frame on this socket. The page is dispatched pixels, and knows nothing
    // about how they were carried here.
    const dispatched =
      input.type === "pointer"
        ? { ...input, sequence: undefined, x: input.x * frame.width, y: input.y * frame.height }
        : input;
    await this.#options.browser.dispatchViewInput(session.tabId, dispatched).catch(() => undefined);
  }

  async #detach(session: ManagedViewSession, client: Ws.WebSocket): Promise<void> {
    if (session.socket !== client) return;
    this.#sessions.delete(session.id);
    session.socket = null;
    const stopView = session.stopView;
    session.stopView = null;
    await stopView?.().catch(() => undefined);
  }

  async #closeSession(session: ManagedViewSession, reason: string): Promise<void> {
    this.#sessions.delete(session.id);
    const client = session.socket;
    session.socket = null;
    const stopView = session.stopView;
    session.stopView = null;
    client?.close(1000, reason.slice(0, 120));
    await stopView?.().catch(() => undefined);
  }
}
