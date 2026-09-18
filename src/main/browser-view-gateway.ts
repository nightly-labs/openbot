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
  browserViewStreamPath,
  browserViewStreamSessionId,
  decodeBrowserViewInput,
  encodeBrowserViewFrame,
} from "@openbot/contracts/team-protocol/browser-view-v1";
import type * as Ws from "ws";
import type { BrowserHost } from "../backend/browser-host";

const requireModule = createRequire(import.meta.url);
const webSockets: typeof Ws = requireModule(join(dirname(requireModule.resolve("ws/package.json")), "index.js"));

/**
 * How many frames may wait in the socket before the next one is dropped. A live view that falls
 * behind must show the page as it is now, not replay the seconds the link was slow.
 */
const MAX_BUFFERED_FRAME_BYTES = 4 * 1024 * 1024;
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
    });
    return { id, tabId: input.tabId, streamPath: browserViewStreamPath(id) };
  }

  async closeMemberSession(id: string, memberId: string): Promise<boolean> {
    const session = this.#sessions.get(id);
    if (!session || session.memberId !== memberId) return false;
    await this.#closeSession(session, "The browser view was closed.");
    return true;
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
    client.on("message", (data, binary) => {
      if (binary || session.socket !== client) return;
      void this.#handleInput(session, data);
    });
    client.once("close", () => void this.#detach(session, client));
    client.once("error", () => void this.#detach(session, client));
    try {
      session.stopView = await this.#options.browser.startView(session.tabId, (frame) => {
        if (session.socket !== client || client.readyState !== webSockets.WebSocket.OPEN) return;
        session.frameWidth = frame.width;
        session.frameHeight = frame.height;
        if (client.bufferedAmount > MAX_BUFFERED_FRAME_BYTES) return;
        client.send(encodeBrowserViewFrame(frame), { binary: true });
      });
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
    // Input that arrives before the first frame has no frame to be a fraction of.
    if (input.type === "pointer" && (session.frameWidth === 0 || session.frameHeight === 0)) return;
    await this.#options.browser
      .dispatchViewInput(
        session.tabId,
        input.type === "pointer"
          ? { ...input, x: input.x * session.frameWidth, y: input.y * session.frameHeight }
          : input,
      )
      .catch(() => undefined);
  }

  async #detach(session: ManagedViewSession, client: Ws.WebSocket): Promise<void> {
    if (session.socket !== client) return;
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

function rawDataSize(data: Ws.RawData): number {
  if (Array.isArray(data)) return data.reduce((total, chunk) => total + chunk.byteLength, 0);
  return data.byteLength;
}

function rawDataText(data: Ws.RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8");
}
