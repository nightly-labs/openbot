import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect, Schema, Semaphore } from "effect";
import type {
  RoutineFlowDiscoveryProcess,
  RoutineFlowDiscoveryRequest,
  RoutineFlowHandoffPage,
  RoutineFlowOwnerCursor,
  RoutineFlowOwnerPage,
} from "./routine-flow-discovery-protocol";

export class RoutineFlowDiscoveryFailed extends Schema.TaggedError<RoutineFlowDiscoveryFailed>()(
  "RoutineFlowDiscoveryFailed",
  {
    reason: Schema.Literals(["closed", "start", "deadline", "worker", "protocol"]),
  },
) {}

export interface RoutineFlowDiscoveryOptions {
  spawn(): RoutineFlowDiscoveryProcess;
  startDeadlineMs?: number;
  queryDeadlineMs?: number;
}

interface Host {
  process: RoutineFlowDiscoveryProcess;
  ready: boolean;
  exited: boolean;
}

function ownerCursor(value: unknown): value is RoutineFlowOwnerCursor {
  return isDynamicRecord(value) && typeof value.updatedAt === "string" && typeof value.runId === "string";
}
function ids(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 128 && value.every((id) => typeof id === "string");
}

/**
 * Owns one read-only discovery process. Requests serialize; each start and SQL read has a deadline.
 * Cancellation kills only this request's host. The next independent sweep can start a new host;
 * this operation never retries. No SQL executes on the Electron thread through this port.
 */
export class RoutineFlowDiscovery {
  readonly #options: RoutineFlowDiscoveryOptions;
  readonly #requests = Semaphore.makeUnsafe(1);
  readonly #owned = new Set<Host>();
  #host: Host | null = null;
  #nextId = 0;
  #closed = false;
  #cancelActive: (() => void) | null = null;

  constructor(options: RoutineFlowDiscoveryOptions) {
    this.#options = options;
  }

  ownerRuns(
    since: string,
    after: RoutineFlowOwnerCursor | null = null,
  ): Effect.Effect<RoutineFlowOwnerPage, RoutineFlowDiscoveryFailed> {
    return this.#request({ id: ++this.#nextId, kind: "owners", since, after }).pipe(
      Effect.map((page) => ({
        runIds: page.runIds,
        after: ownerCursor(page.after) ? page.after : null,
      })),
    );
  }

  pendingHandoffs(
    since: string,
    after: string | null = null,
  ): Effect.Effect<RoutineFlowHandoffPage, RoutineFlowDiscoveryFailed> {
    return this.#request({ id: ++this.#nextId, kind: "handoffs", since, after }).pipe(
      Effect.map((page) => ({
        runIds: page.runIds,
        after: typeof page.after === "string" ? page.after : null,
      })),
    );
  }

  resultRuns(
    since: string,
    after: RoutineFlowOwnerCursor | null = null,
  ): Effect.Effect<RoutineFlowOwnerPage, RoutineFlowDiscoveryFailed> {
    return this.#request({ id: ++this.#nextId, kind: "results", since, after }).pipe(
      Effect.map((page) => ({ runIds: page.runIds, after: ownerCursor(page.after) ? page.after : null })),
    );
  }

  #request(
    request: RoutineFlowDiscoveryRequest,
  ): Effect.Effect<RoutineFlowOwnerPage | RoutineFlowHandoffPage, RoutineFlowDiscoveryFailed> {
    return this.#requests.withPermit(
      Effect.callback<RoutineFlowOwnerPage | RoutineFlowHandoffPage, RoutineFlowDiscoveryFailed>((resume) => {
        if (this.#closed) {
          resume(Effect.fail(new RoutineFlowDiscoveryFailed({ reason: "closed" })));
          return;
        }
        let host: Host;
        try {
          host = this.#ensureHost();
        } catch {
          resume(Effect.fail(new RoutineFlowDiscoveryFailed({ reason: "start" })));
          return;
        }
        let settled = false;
        let sent = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let offMessage = () => {};
        let offExit = () => {};
        const cleanup = () => {
          if (timer) clearTimeout(timer);
          offMessage();
          offExit();
          if (this.#cancelActive === cancel) this.#cancelActive = null;
        };
        const fail = (reason: RoutineFlowDiscoveryFailed["reason"]) => {
          if (settled) return;
          settled = true;
          cleanup();
          this.#kill(host);
          resume(Effect.fail(new RoutineFlowDiscoveryFailed({ reason })));
        };
        const cancel = () => fail("closed");
        const send = () => {
          if (sent || settled) return;
          sent = true;
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => fail("deadline"), this.#options.queryDeadlineMs ?? 5_000);
          try {
            host.process.send(request);
          } catch {
            fail("worker");
          }
        };
        this.#cancelActive = cancel;
        offMessage = host.process.onMessage((message) => {
          if (settled || !isDynamicRecord(message)) return;
          if (message.kind === "ready") {
            host.ready = true;
            send();
            return;
          }
          if (message.kind === "startup-failed") {
            fail("start");
            return;
          }
          if (message.id !== request.id) return;
          if (message.kind === "failed") {
            fail("worker");
            return;
          }
          if (
            message.kind !== request.kind ||
            !ids(message.runIds) ||
            (request.kind !== "handoffs"
              ? message.after !== null && !ownerCursor(message.after)
              : message.after !== null && typeof message.after !== "string")
          ) {
            fail("protocol");
            return;
          }
          settled = true;
          cleanup();
          if (request.kind !== "handoffs")
            resume(
              Effect.succeed({ runIds: message.runIds, after: ownerCursor(message.after) ? message.after : null }),
            );
          else
            resume(
              Effect.succeed({
                runIds: message.runIds,
                after: typeof message.after === "string" ? message.after : null,
              }),
            );
        });
        offExit = host.process.onExit(() => fail("worker"));
        timer = setTimeout(() => fail("start"), this.#options.startDeadlineMs ?? 15_000);
        if (host.ready) send();
        return Effect.sync(() => {
          if (!settled) {
            settled = true;
            cleanup();
            this.#kill(host);
          }
        });
      }),
    );
  }

  #ensureHost(): Host {
    if (this.#host) return this.#host;
    if (this.#owned.size >= 2) throw new Error("A discovery host has not stopped.");
    const host: Host = { process: this.#options.spawn(), ready: false, exited: false };
    this.#host = host;
    this.#owned.add(host);
    const offReady = host.process.onMessage((message) => {
      if (isDynamicRecord(message) && message.kind === "ready") host.ready = true;
    });
    const offExit = host.process.onExit(() => {
      host.exited = true;
      this.#owned.delete(host);
      if (this.#host === host) this.#host = null;
      offReady();
      offExit();
    });
    return host;
  }

  #kill(host: Host): void {
    if (this.#host === host) this.#host = null;
    try {
      host.process.kill();
    } catch {
      /* A host that exited already has no handle to close. */
    }
  }

  readonly close = Effect.fn("RoutineFlowDiscovery.close")(function* (this: RoutineFlowDiscovery) {
    this.#closed = true;
    this.#cancelActive?.();
    for (const host of [...this.#owned]) {
      yield* Effect.callback<void>((resume) => {
        if (host.exited) {
          resume(Effect.void);
          return;
        }
        let timer: ReturnType<typeof setTimeout>;
        const offExit = host.process.onExit(() => resume(Effect.void));
        this.#kill(host);
        timer = setTimeout(() => resume(Effect.void), 2_000);
        return Effect.sync(() => {
          clearTimeout(timer);
          offExit();
        });
      });
    }
  }, Effect.uninterruptible).bind(this);
}
