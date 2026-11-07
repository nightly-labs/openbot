import { Effect, type Scope } from "effect";
import type { AgentClient } from "../agent-client";

/** What a release found. `held`: something still needs the session. `gone`: no client holds it to release. */
type IdleSessionRelease = "released" | "held" | "gone";

export interface CodexIdleSessionsOptions {
  /** How long a session with no turn stays loaded. */
  releaseAfterMs: number;
  /** How many idle sessions of one client stay loaded before the timeout. */
  idleLimit: number;
  scope(): Scope.Scope;
  /**
   * Whether the session is an agent session that the client holds and can resume. A generation or a
   * routine run has no such session, and must not count against the limit.
   */
  tracks(externalThreadId: string, client: AgentClient): boolean;
  /** Unloads one session from its client when nothing needs it. See `ThreadLifecycle.releaseIdleSession`. */
  release(externalThreadId: string, client: AgentClient): Effect.Effect<IdleSessionRelease>;
}

interface IdleSession {
  readonly client: AgentClient;
  /** When the last turn ended; `0` while a turn runs. The longest idle session is the first to go. */
  idleSince: number;
  timer: ReturnType<typeof setTimeout> | null;
  releasing: boolean;
}

/**
 * The idle timers of the sessions in the Codex app servers. One app server holds every Codex thread
 * of its account, with the MCP servers and terminals of each thread, until the whole process is idle.
 * This unloads each session that has no turn after a timeout, and at once each idle session over the
 * limit of its client. The session stays: its next turn resumes it.
 *
 * Claude and the ACP clients close their own idle threads in `IdleThreadPool`. A Codex session
 * resumes only through `ThreadLifecycle`, which builds the resume parameters, so its release is at
 * the agent level and not in the client.
 */
export class CodexIdleSessions {
  readonly #options: CodexIdleSessionsOptions;
  readonly #sessions = new Map<string, IdleSession>();

  constructor(options: CodexIdleSessionsOptions) {
    this.#options = options;
  }

  /** A turn started in the session: it is not idle until the turn ends. */
  busy(externalThreadId: string, client: AgentClient): void {
    if (!this.#options.tracks(externalThreadId, client)) return;
    const session = this.#session(externalThreadId, client);
    session.idleSince = 0;
    this.#disarm(session);
  }

  /** The turn of the session ended. Starts its timer, and releases the longest idle sessions over the limit. */
  idle(externalThreadId: string, client: AgentClient): void {
    if (!this.#options.tracks(externalThreadId, client)) return;
    const session = this.#session(externalThreadId, client);
    session.idleSince = Date.now();
    this.#arm(externalThreadId, session);
    this.#releaseOver(client, this.#options.idleLimit);
  }

  /** Releases every idle session before its timeout, when the computer is low on memory. */
  releaseIdle(): void {
    const clients = new Set([...this.#sessions.values()].map((session) => session.client));
    for (const client of clients) this.#releaseOver(client, 0);
  }

  /** The client stopped: its sessions ended with it. */
  clientStopped(client: AgentClient): void {
    for (const [externalThreadId, session] of this.#sessions) {
      if (session.client !== client) continue;
      this.#disarm(session);
      this.#sessions.delete(externalThreadId);
    }
  }

  dispose(): void {
    for (const session of this.#sessions.values()) this.#disarm(session);
    this.#sessions.clear();
  }

  #session(externalThreadId: string, client: AgentClient): IdleSession {
    const current = this.#sessions.get(externalThreadId);
    if (current?.client === client) return current;
    if (current) this.#disarm(current);
    const session: IdleSession = { client, idleSince: 0, timer: null, releasing: false };
    this.#sessions.set(externalThreadId, session);
    return session;
  }

  #arm(externalThreadId: string, session: IdleSession): void {
    this.#disarm(session);
    session.timer = setTimeout(() => {
      session.timer = null;
      this.#release(externalThreadId, session);
    }, this.#options.releaseAfterMs);
    session.timer.unref?.();
  }

  #disarm(session: IdleSession): void {
    if (session.timer) clearTimeout(session.timer);
    session.timer = null;
  }

  #releaseOver(client: AgentClient, limit: number): void {
    const idle = [...this.#sessions]
      .filter(([, session]) => session.client === client && session.idleSince > 0 && !session.releasing)
      .sort(([, left], [, right]) => left.idleSince - right.idleSince);
    for (const [externalThreadId, session] of idle.slice(0, Math.max(0, idle.length - limit))) {
      this.#release(externalThreadId, session);
    }
  }

  #release(externalThreadId: string, session: IdleSession): void {
    if (this.#sessions.get(externalThreadId) !== session || session.idleSince === 0 || session.releasing) return;
    this.#disarm(session);
    session.releasing = true;
    const release = this.#options.release(externalThreadId, session.client).pipe(
      Effect.tap((result) =>
        Effect.sync(() => {
          session.releasing = false;
          if (this.#sessions.get(externalThreadId) !== session) return;
          // A turn that started in the release resumed the session, and its end arms the timer again.
          if (session.idleSince === 0) return;
          if (result === "held") this.#arm(externalThreadId, session);
          else this.#sessions.delete(externalThreadId);
        }),
      ),
    );
    Effect.runFork(release.pipe(Effect.forkIn(this.#options.scope(), { startImmediately: true })));
  }
}
