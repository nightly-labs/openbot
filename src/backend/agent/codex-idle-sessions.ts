import { Effect, type Scope } from "effect";
import type { AgentClient } from "../agent-client";

type IdleSessionRelease = "released" | "held" | "gone";

export interface CodexIdleSessionsOptions {
  releaseAfterMs: number;
  idleLimit: number;
  scope(): Scope.Scope;
  tracks(externalThreadId: string, client: AgentClient): boolean;
  release(externalThreadId: string, client: AgentClient): Effect.Effect<IdleSessionRelease>;
}

interface IdleSession {
  readonly client: AgentClient;
  idleSince: number;
  timer: ReturnType<typeof setTimeout> | null;
  releasing: boolean;
}

export class CodexIdleSessions {
  readonly #options: CodexIdleSessionsOptions;
  readonly #sessions = new Map<string, IdleSession>();

  constructor(options: CodexIdleSessionsOptions) {
    this.#options = options;
  }

  busy(externalThreadId: string, client: AgentClient): void {
    if (!this.#options.tracks(externalThreadId, client)) return;
    const session = this.#session(externalThreadId, client);
    session.idleSince = 0;
    this.#disarm(session);
  }

  idle(externalThreadId: string, client: AgentClient): void {
    if (!this.#options.tracks(externalThreadId, client)) return;
    const session = this.#session(externalThreadId, client);
    session.idleSince = Date.now();
    this.#arm(externalThreadId, session);
    this.#releaseOver(client, this.#options.idleLimit);
  }

  releaseIdle(): void {
    const clients = new Set([...this.#sessions.values()].map((session) => session.client));
    for (const client of clients) this.#releaseOver(client, 0);
  }

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
          if (session.idleSince === 0) return;
          if (result === "held") this.#arm(externalThreadId, session);
          else this.#sessions.delete(externalThreadId);
        }),
      ),
    );
    Effect.runFork(release.pipe(Effect.forkIn(this.#options.scope(), { startImmediately: true })));
  }
}
