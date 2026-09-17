import { EventEmitter } from "node:events";
import {
  REMOTE_DESKTOP_ERROR_CODES,
  type RemoteDesktopConnectInput,
  type RemoteDesktopConnectResult,
  type RemoteDesktopSession,
} from "@openbot/contracts/ipc";
import { RemoteRequestError } from "./remote-server-errors";
import type { RemoteServerManager } from "./remote-server-manager";

interface RemoteDesktopEvents {
  changed: [sessions: RemoteDesktopSession[]];
}

export class RemoteDesktopManager extends EventEmitter<RemoteDesktopEvents> {
  readonly #servers: Pick<
    RemoteServerManager,
    "createRemoteDesktopSession" | "closeRemoteDesktopSession" | "selectRemoteDesktopDisplay"
  >;
  readonly #sessions = new Map<string, RemoteDesktopSession>();

  constructor(
    servers: Pick<
      RemoteServerManager,
      "createRemoteDesktopSession" | "closeRemoteDesktopSession" | "selectRemoteDesktopDisplay"
    >,
  ) {
    super();
    this.#servers = servers;
  }

  list(): RemoteDesktopSession[] {
    return [...this.#sessions.values()].map((session) => structuredClone(session));
  }

  async connect(input: RemoteDesktopConnectInput): Promise<RemoteDesktopConnectResult> {
    const existing = [...this.#sessions.values()].find((session) => session.serverId === input.serverId);
    if (existing) return { status: "connected", session: structuredClone(existing) };
    let session: RemoteDesktopSession;
    try {
      session = await this.#servers.createRemoteDesktopSession(input.serverId);
    } catch (error) {
      // A named refusal is the host's answer, not a broken call, and the renderer needs the name to
      // tell a setup step apart from a retry. Anything else still rejects.
      const refusal = hostRefusal(error);
      if (!refusal) throw error;
      return refusal;
    }
    this.#sessions.set(session.id, session);
    this.#emitChanged();
    return { status: "connected", session: structuredClone(session) };
  }

  async disconnect(sessionId: string): Promise<void> {
    const session = this.#sessions.get(sessionId);
    if (!session) return;
    this.#sessions.delete(sessionId);
    this.#emitChanged();
    await this.#servers.closeRemoteDesktopSession(session.serverId, session.id).catch(() => undefined);
  }

  async selectDisplay(serverId: string, displayId: string): Promise<void> {
    await this.#servers.selectRemoteDesktopDisplay(serverId, displayId);
    for (const [id, session] of this.#sessions) {
      if (session.serverId !== serverId) continue;
      this.#sessions.set(id, { ...session, selectedDisplayId: displayId, phase: "connecting" });
    }
    this.#emitChanged();
  }

  async stop(): Promise<void> {
    await Promise.all([...this.#sessions.keys()].map((sessionId) => this.disconnect(sessionId)));
  }

  #emitChanged(): void {
    this.emit("changed", this.list());
  }
}

function hostRefusal(error: unknown): Extract<RemoteDesktopConnectResult, { status: "refused" }> | null {
  if (!(error instanceof RemoteRequestError)) return null;
  const errorCode = REMOTE_DESKTOP_ERROR_CODES.find((candidate) => candidate === error.code);
  return errorCode ? { status: "refused", errorCode, message: error.message } : null;
}
