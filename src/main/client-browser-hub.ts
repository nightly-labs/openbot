import { createHash, randomUUID } from "node:crypto";
import {
  CLIENT_BROWSER_COMMAND_TIMEOUT_MS,
  CLIENT_BROWSER_EVENT,
  CLIENT_BROWSER_LIMITS,
  CLIENT_BROWSER_PRESENCE_TTL_MS,
  type ClientBrowserAnswer,
  type ClientBrowserCommand,
  type ClientBrowserCommandEvent,
  type ClientBrowserPresence,
  type ClientBrowserResult,
  type ClientTab,
  clientBrowserCommandEvent,
} from "@openbot/contracts/team-protocol/client-browser-v1";
import { Effect } from "effect";
import { type ClientBrowser, ClientBrowserFailed, type SharedChrome } from "../backend/agent/client-browser-tools";

type Deliver = (memberId: string, sessionId: string, event: ClientBrowserCommandEvent) => boolean;

function chromeKey(sessionId: string): string {
  return createHash("sha256").update(sessionId).digest("hex").slice(0, 6);
}

interface Presence {
  memberId: string;
  tabs: ClientTab[];
  order: number;
  expiry: ReturnType<typeof setTimeout>;
}

interface Pending {
  memberId: string;
  sessionId: string;
  answer: (answer: ClientBrowserAnswer) => void;
}

function refused(id: string, code: "not-shared" | "timeout"): ClientBrowserAnswer {
  return { id, ok: false, error: "", code };
}

export class ClientBrowserHub implements ClientBrowser {
  readonly #presence = new Map<string, Presence>();
  readonly #pending = new Map<string, Pending>();
  readonly #deliver = new Set<Deliver>();
  readonly #timing: { commandMs: number; presenceMs: number };
  #order = 0;

  constructor(timing = { commandMs: CLIENT_BROWSER_COMMAND_TIMEOUT_MS, presenceMs: CLIENT_BROWSER_PRESENCE_TTL_MS }) {
    this.#timing = timing;
  }

  setPresence(memberId: string, sessionId: string, presence: ClientBrowserPresence): void {
    const current = this.#presence.get(sessionId);
    if (!presence.sharing || (current && current.memberId !== memberId)) this.sessionEnded(sessionId);
    if (!presence.sharing) return;
    const kept = this.#presence.get(sessionId);
    if (kept) clearTimeout(kept.expiry);
    const expiry = setTimeout(() => this.sessionEnded(sessionId), this.#timing.presenceMs);
    expiry.unref?.();
    this.#presence.set(sessionId, { memberId, tabs: presence.tabs, order: kept?.order ?? ++this.#order, expiry });
  }

  sessionEnded(sessionId: string): void {
    const presence = this.#presence.get(sessionId);
    if (presence) clearTimeout(presence.expiry);
    this.#presence.delete(sessionId);
    for (const [id, pending] of this.#pending)
      if (pending.sessionId === sessionId) {
        this.#pending.delete(id);
        pending.answer(refused(id, "not-shared"));
      }
  }

  shares(sessionId: string): boolean {
    return this.#presence.has(sessionId);
  }

  tabs(memberId: string): SharedChrome[] | null {
    const chromes = this.#sessions(memberId).map(({ sessionId, presence }) => ({
      chrome: chromeKey(sessionId),
      tabs: presence.tabs,
    }));
    return chromes.length ? chromes : null;
  }

  call(
    memberId: string,
    chrome: string,
    agent: { id: string; name: string },
    command: ClientBrowserCommand,
  ): Effect.Effect<ClientBrowserResult, ClientBrowserFailed> {
    return Effect.suspend(() => {
      const sessions = this.#sessions(memberId);
      if (!sessions.length) return Effect.fail(new ClientBrowserFailed({ code: "not-shared", message: "" }));
      const current = sessions.find(({ sessionId }) => chromeKey(sessionId) === chrome);
      if (!current) return Effect.fail(new ClientBrowserFailed({ code: "not-found", message: "" }));
      const event: ClientBrowserCommandEvent = {
        type: CLIENT_BROWSER_EVENT,
        id: randomUUID(),
        agentId: agent.id,
        agentName: agent.name.slice(0, CLIENT_BROWSER_LIMITS.agentName),
        command,
      };
      try {
        clientBrowserCommandEvent(event);
      } catch {
        return Effect.fail(
          new ClientBrowserFailed({ code: "failed", message: "The command is not valid for Chrome." }),
        );
      }
      const { sessionId } = current;
      return Effect.callback<ClientBrowserAnswer>((resume) => {
        this.#pending.set(event.id, { memberId, sessionId, answer: (answer) => resume(Effect.succeed(answer)) });
        let delivered = false;
        for (const deliver of this.#deliver) delivered = deliver(memberId, sessionId, event) || delivered;
        if (!delivered) {
          this.#pending.delete(event.id);
          resume(Effect.succeed(refused(event.id, "not-shared")));
        }
      }).pipe(
        Effect.timeoutOrElse({
          duration: this.#timing.commandMs,
          orElse: () => Effect.succeed(refused(event.id, "timeout")),
        }),
        Effect.ensuring(Effect.sync(() => this.#pending.delete(event.id))),
        Effect.flatMap((answer) =>
          answer.ok
            ? Effect.succeed(answer.result)
            : Effect.fail(new ClientBrowserFailed({ code: answer.code, message: answer.error })),
        ),
      );
    });
  }

  resolve(memberId: string, sessionId: string, answer: ClientBrowserAnswer): boolean {
    const pending = this.#pending.get(answer.id);
    if (!pending || pending.memberId !== memberId || pending.sessionId !== sessionId) return false;
    this.#pending.delete(answer.id);
    pending.answer(answer);
    return true;
  }

  subscribe(deliver: Deliver): () => void {
    this.#deliver.add(deliver);
    return () => this.#deliver.delete(deliver);
  }

  dispose(): void {
    for (const sessionId of [...this.#presence.keys()]) this.sessionEnded(sessionId);
    for (const [id, pending] of this.#pending) pending.answer(refused(id, "not-shared"));
    this.#pending.clear();
    this.#deliver.clear();
  }

  #sessions(memberId: string): { sessionId: string; presence: Presence }[] {
    return [...this.#presence]
      .filter(([, presence]) => presence.memberId === memberId)
      .sort(([, left], [, right]) => right.order - left.order)
      .map(([sessionId, presence]) => ({ sessionId, presence }));
  }
}
