import { randomUUID } from "node:crypto";
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
import { type ClientBrowser, ClientBrowserFailed } from "../backend/agent/client-browser-tools";

// The host end of `client-browser-v1`: the Chrome tabs that members share with the agents of this host.
// It keeps the presence of each logical session that shares, and the commands that wait for a result.
// It logs nothing: tabs, pages and typed text are user data.

/** Sends the command to the event connections of the member's session; false when none is open. */
type Deliver = (memberId: string, sessionId: string, event: ClientBrowserCommandEvent) => boolean;

interface Presence {
  memberId: string;
  tabs: ClientTab[];
  /** Higher is newer. The newest session of a member that started to share gets the commands. */
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

  /** The contract's limits; a test gives shorter ones. */
  constructor(timing = { commandMs: CLIENT_BROWSER_COMMAND_TIMEOUT_MS, presenceMs: CLIENT_BROWSER_PRESENCE_TTL_MS }) {
    this.#timing = timing;
  }

  /** The presence that a session sent. `sharing: false` ends it. */
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

  /** The session stopped sharing, closed its last event connection, or sent no presence in time. */
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

  tabs(memberId: string): ClientTab[] | null {
    return this.#current(memberId)?.presence.tabs ?? null;
  }

  call(
    memberId: string,
    agent: { id: string; name: string },
    command: ClientBrowserCommand,
  ): Effect.Effect<ClientBrowserResult, ClientBrowserFailed> {
    return Effect.suspend(() => {
      const current = this.#current(memberId);
      if (!current) return Effect.fail(new ClientBrowserFailed({ code: "not-shared", message: "" }));
      const event: ClientBrowserCommandEvent = {
        type: CLIENT_BROWSER_EVENT,
        id: randomUUID(),
        agentId: agent.id,
        agentName: agent.name.slice(0, CLIENT_BROWSER_LIMITS.agentName),
        command,
      };
      // A client closes its event stream on an event that the contract refuses, so such a command stays here.
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
        // A cancelled tool call, a timeout or a result: a later result of the command finds nothing.
        Effect.ensuring(Effect.sync(() => this.#pending.delete(event.id))),
        Effect.flatMap((answer) =>
          answer.ok
            ? Effect.succeed(answer.result)
            : Effect.fail(new ClientBrowserFailed({ code: answer.code, message: answer.error })),
        ),
      );
    });
  }

  /** The result of a command. False for a command that does not wait, or that another member or session got. */
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

  #current(memberId: string): { sessionId: string; presence: Presence } | null {
    let best: { sessionId: string; presence: Presence } | null = null;
    for (const [sessionId, presence] of this.#presence)
      if (presence.memberId === memberId && (!best || presence.order > best.presence.order))
        best = { sessionId, presence };
    return best;
  }
}
