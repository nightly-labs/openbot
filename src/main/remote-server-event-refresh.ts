// How an invalidation turns back into state the renderer can show.
//
// A host does not send a new conversation page when a message lands. It sends
// "conversation 42 changed to revision 7", and this file fetches revision 7. That indirection is
// what keeps a busy agent from pushing a full page down the socket on every token, and it is why
// the interesting code here is about *not* fetching:
//
//   - **Coalescing.** While one refetch is in flight, further invalidations for the same agent
//     raise the wanted revision instead of starting a second request. One fetch per burst, and the
//     loop reruns only if the revision moved while it was away.
//   - **Generations.** A refetch started before a reconnect must not emit after it: its answer
//     describes a session that is over. Every event bumps the generation, and a slow response
//     checks it before emitting.
//
// The fallback path is for hosts too old to replay events on connect. It reads the whole agent list
// and one page each, which is expensive, so it runs once per connection rather than per event.

import type { AgentEvent } from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { Deferred, Effect, Result } from "effect";
import { decodeAgentSummaries, decodeQueueSnapshot } from "./remote-agent-decoding";
import { decodeConversationPageFromHost } from "./remote-conversation-decoding";
import type { RemoteRequestFn } from "./remote-server-client";
import { addRemotePreviewUrls, pageQuery } from "./remote-server-urls";
import type { RemoteWorkflowError } from "./remote-service-effects";

// One in-flight conversation refetch, and the newest revision asked for while it was running.
// `sequence` counts announcements that did not move the revision: a read on another device changes
// the page's unread counts without changing its content revision, so the revision alone cannot tell
// "nothing has happened" from "something happened that this page still has to be refetched for".
interface ConversationRefresh {
  revision: number;
  sequence: number;
}

// One in-flight queue refetch. The queue has no revision, so "changed again" is all there is to say.
interface QueueRefresh {
  dirty: boolean;
}

const FALLBACK_CONVERSATION_LIMIT = 1;
const INVALIDATED_CONVERSATION_LIMIT = 50;

export interface RemoteEventRefreshOptions {
  request: RemoteRequestFn;
  /** False once the user removes a server. A refetch in flight for it stops emitting. */
  hasServer: (serverId: string) => boolean;
  emit: (serverId: string, event: AgentEvent, bufferedLive?: boolean) => void;
}

export class RemoteEventRefresh {
  readonly #request: RemoteRequestFn;
  readonly #hasServer: (serverId: string) => boolean;
  readonly #emit: (serverId: string, event: AgentEvent, bufferedLive?: boolean) => void;
  readonly #conversations = new Map<string, ConversationRefresh>();
  readonly #queues = new Map<string, QueueRefresh>();
  readonly #generations = new Map<string, number>();
  readonly #rosterLoads = new Map<string, Deferred.Deferred<void, RemoteWorkflowError>>();

  constructor(options: RemoteEventRefreshOptions) {
    this.#request = options.request;
    this.#hasServer = options.hasServer;
    this.#emit = options.emit;
  }

  /**
   * One event from a host. An invalidation starts a refetch; anything else is already the state and
   * goes straight out. `bufferedLive` marks an event that arrived while the fallback was loading,
   * so the renderer can tell it apart from the snapshot it is patching.
   */
  readonly forward = Effect.fn("RemoteEvents.forward")(function* (
    this: RemoteEventRefresh,
    serverId: string,
    event: AgentEvent,
    bufferedLive = false,
  ) {
    this.#advance(serverId);
    if (event.type === "agents-changed") this.#rosterLoads.delete(serverId);
    if (event.type === "conversation-invalidated") {
      yield* this.#refreshConversationPage(serverId, event.agentId, event.revision);
    } else if (event.type === "queue-invalidated") {
      yield* this.#refreshQueue(serverId, event.agentId);
    } else {
      const remoteEvent = addRemotePreviewUrls(event, serverId);
      if (bufferedLive) this.#emit(serverId, remoteEvent, true);
      else this.#emit(serverId, remoteEvent);
    }
  }).bind(this);

  /**
   * Builds the current state from scratch, for a host that cannot replay what was missed. One agent
   * failing is not the server failing, so each is caught on its own.
   */

  readonly refreshAgentState = Effect.fn("RemoteEvents.refreshAgentState")(function* (
    this: RemoteEventRefresh,
    serverId: string,
  ) {
    const generation = this.#advance(serverId);
    const request = { request: this.#request };
    const agents = yield* request.request(serverId, TEAM_API_ROUTES.agents.all, decodeAgentSummaries);
    if (this.#generations.get(serverId) !== generation) return;
    this.#emit(serverId, { type: "agents-changed", agents });
    yield* Effect.forEach(
      agents,
      (agent) =>
        Effect.gen({ self: this }, function* () {
          const [page, queue] = yield* Effect.all(
            [
              this.#conversationPageEffect(serverId, agent.id, FALLBACK_CONVERSATION_LIMIT),
              request.request(serverId, TEAM_API_ROUTES.agent.queue(agent.id), decodeQueueSnapshot),
            ],
            { concurrency: "unbounded" },
          );
          if (this.#generations.get(serverId) !== generation) return;
          const { pageInfo: _, references: __, readState: ___, ...snapshot } = page;
          this.#emit(serverId, { type: "conversation", snapshot });
          this.#emit(serverId, { type: "queue-changed", snapshot: queue });
        }).pipe(Effect.catch(() => Effect.void)),
      { concurrency: "unbounded", discard: true },
    );
  }).bind(this);

  /** Shared admission keeps a roster response bound to its generation. */
  readonly refreshAgentRoster = Effect.fn("RemoteEvents.refreshAgentRoster")(function* (
    this: RemoteEventRefresh,
    serverId: string,
  ) {
    const pending = this.#rosterLoads.get(serverId);
    if (pending) return yield* Deferred.await(pending);
    const operation = Deferred.makeUnsafe<void, RemoteWorkflowError>();
    this.#rosterLoads.set(serverId, operation);
    yield* Effect.gen({ self: this }, function* () {
      const agents = yield* this.#request(serverId, TEAM_API_ROUTES.agents.all, decodeAgentSummaries);
      if (this.#rosterLoads.get(serverId) !== operation || !this.#hasServer(serverId)) return;
      this.#emit(serverId, { type: "agents-changed", agents });
    }).pipe(
      Effect.onExit((exit) => Deferred.done(operation, exit)),
      Effect.ensuring(
        Effect.sync(() => {
          if (this.#rosterLoads.get(serverId) === operation) this.#rosterLoads.delete(serverId);
        }),
      ),
    );
  }).bind(this);

  forget(serverId: string): void {
    this.#rosterLoads.delete(serverId);
    this.#generations.delete(serverId);
    for (const key of this.#conversations.keys()) {
      if (key.startsWith(`${serverId}\0`)) this.#conversations.delete(key);
    }
    for (const key of this.#queues.keys()) {
      if (key.startsWith(`${serverId}\0`)) this.#queues.delete(key);
    }
  }

  clear(): void {
    this.#rosterLoads.clear();
    this.#generations.clear();
    this.#conversations.clear();
    this.#queues.clear();
  }

  readonly #refreshConversationPage = Effect.fn("RemoteEvents.refreshConversationPage")(function* (
    this: RemoteEventRefresh,
    serverId: string,
    agentId: string,
    revision: number,
  ) {
    const key = `${serverId}\0${agentId}`;
    const pending = this.#conversations.get(key);
    if (pending) {
      if (pending.revision === revision) pending.sequence += 1;
      pending.revision = Math.max(pending.revision, revision);
      return;
    }
    const request = { revision, sequence: 0 };
    this.#conversations.set(key, request);
    yield* Effect.gen({ self: this }, function* () {
      while (this.#hasServer(serverId)) {
        const requestedRevision = request.revision;
        const requestedSequence = request.sequence;
        const result = yield* this.#conversationPageEffect(serverId, agentId, INVALIDATED_CONVERSATION_LIMIT).pipe(
          Effect.result,
        );
        if (Result.isFailure(result)) {
          if (request.sequence !== requestedSequence || request.revision !== requestedRevision) continue;
          return;
        }
        const page = result.success;
        if (request.sequence !== requestedSequence) continue;
        if (page.revision >= request.revision) {
          this.#emit(serverId, { type: "conversation-page", page });
          return;
        }
        if (request.revision === requestedRevision) return;
      }
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          if (this.#conversations.get(key) === request) this.#conversations.delete(key);
        }),
      ),
    );
  });

  readonly #refreshQueue = Effect.fn("RemoteEvents.refreshQueue")(function* (
    this: RemoteEventRefresh,
    serverId: string,
    agentId: string,
  ) {
    const key = `${serverId}\0${agentId}`;
    const pending = this.#queues.get(key);
    if (pending) {
      pending.dirty = true;
      return;
    }
    const request = { dirty: false };
    this.#queues.set(key, request);
    yield* Effect.gen({ self: this }, function* () {
      do {
        request.dirty = false;
        const result = yield* this.#request(serverId, TEAM_API_ROUTES.agent.queue(agentId), decodeQueueSnapshot).pipe(
          Effect.result,
        );
        if (Result.isFailure(result)) {
          if (request.dirty) continue;
          return;
        }
        if (!this.#hasServer(serverId)) return;
        this.#emit(serverId, { type: "queue-changed", snapshot: result.success });
      } while (request.dirty);
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          if (this.#queues.get(key) === request) this.#queues.delete(key);
        }),
      ),
    );
  });

  readonly #conversationPageEffect = Effect.fn("RemoteEvents.conversationPage")(
    (serverId: string, agentId: string, limit: number) =>
      this.#request(
        serverId,
        `${TEAM_API_ROUTES.agent.conversationPage(agentId)}${pageQuery({ type: "latest" }, limit)}`,
        decodeConversationPageFromHost,
      ),
  );

  /**
   * Marks everything in flight as belonging to a previous session. A response that started before
   * this call will notice and stay quiet.
   */
  #advance(serverId: string): number {
    const generation = (this.#generations.get(serverId) ?? 0) + 1;
    this.#generations.set(serverId, generation);
    return generation;
  }
}
