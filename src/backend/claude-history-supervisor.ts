import { createHash } from "node:crypto";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result } from "effect";
import { type ClaudeHistoryOptions, claudeHistoryIndexPath } from "./claude-history";
import type {
  ClaudeHistoryHostMessage,
  ClaudeHistoryHostProcess,
  ClaudeHistoryReaderFactory,
} from "./claude-history-host-protocol";
import { LineTooLongError } from "./jsonl";
import { providerFailure } from "./provider-client-effects";
import type { ProviderHistoryConsumer, ProviderHistoryRequest } from "./provider-history";

interface Scan {
  id: number;
  options: ClaudeHistoryOptions;
  request: ProviderHistoryRequest;
  consume: ProviderHistoryConsumer;
  signal: AbortSignal;
  sequence: number;
  consuming: boolean;
  controller: AbortController;
  settled: boolean;
  consumerDone?: Promise<void>;
  resolve(): void;
  reject(cause: unknown): void;
  detach(): void;
}
export interface ClaudeHistorySupervisorOptions {
  spawnHost(): ClaudeHistoryHostProcess;
  hostStartDeadlineMs?: number;
  hostStopDeadlineMs?: number;
}

/** Four bounded background lanes. Aliases of one derived index always use the same lane. */
export class ClaudeHistorySupervisor {
  readonly #lanes: ClaudeHistoryLane[];

  constructor(options: ClaudeHistorySupervisorOptions) {
    this.#lanes = Array.from({ length: 4 }, () => new ClaudeHistoryLane(options));
  }

  readonly reader: ClaudeHistoryReaderFactory = (options) => (request, consume) => {
    const path = claudeHistoryIndexPath(options, request.threadId);
    const key = process.platform === "win32" ? path.toLowerCase() : path;
    const lane = createHash("sha256").update(key).digest()[0] ?? 0;
    const selected = this.#lanes[lane % this.#lanes.length];
    return selected ? selected.reader(options)(request, consume) : Effect.fail(providerFailure(unavailable()));
  };

  close() {
    return Effect.all(
      this.#lanes.map((lane) => lane.close()),
      { concurrency: "unbounded", discard: true },
    );
  }
}

/** One persistent process per lane; cancellation waits for its exit before another start. */
class ClaudeHistoryLane {
  readonly #options: ClaudeHistorySupervisorOptions;
  readonly #queue: Scan[] = [];
  #host: ClaudeHistoryHostProcess | null = null;
  #retiring: ClaudeHistoryHostProcess | null = null;
  #ready = false;
  #startDeadline: ReturnType<typeof setTimeout> | null = null;
  #active: Scan | null = null;
  #nextId = 0;
  #closed = false;
  readonly #exits = new Map<ClaudeHistoryHostProcess, Promise<void>>();
  readonly #consumers = new Set<Promise<void>>();

  constructor(options: ClaudeHistorySupervisorOptions) {
    this.#options = options;
  }

  readonly reader: ClaudeHistoryReaderFactory = (options) => (request, consume) =>
    Effect.tryPromise({
      try: (signal) =>
        new Promise<void>((resolve, reject) => {
          if (this.#closed) {
            reject(unavailable());
            return;
          }
          const controller = new AbortController();
          const scan: Scan = {
            id: ++this.#nextId,
            options,
            request,
            consume,
            signal: AbortSignal.any([signal, controller.signal]),
            controller,
            settled: false,
            sequence: 0,
            consuming: false,
            resolve,
            reject,
            detach: () => signal.removeEventListener("abort", abort),
          };
          const abort = () => this.#cancel(scan, signal.reason);
          signal.addEventListener("abort", abort, { once: true });
          if (signal.aborted) {
            abort();
            return;
          }
          this.#queue.push(scan);
          this.#pump();
        }),
      catch: providerFailure,
    });

  close() {
    return Effect.suspend(() => {
      this.#closed = true;
      const host = this.#host;
      this.#host = null;
      this.#ready = false;
      this.#clearStartDeadline();
      if (this.#active) this.#settle(this.#active, unavailable());
      for (const scan of this.#queue.splice(0)) this.#settle(scan, unavailable());
      host?.kill();
      this.#retiring?.kill();
      const exits = [...this.#exits.values(), ...this.#consumers];
      return Effect.tryPromise({
        try: () =>
          new Promise<void>((resolve, reject) => {
            const deadline = setTimeout(() => reject(unavailable()), this.#options.hostStopDeadlineMs ?? 10_000);
            void Promise.all(exits).then(
              () => {
                clearTimeout(deadline);
                resolve();
              },
              (failure) => {
                clearTimeout(deadline);
                reject(failure);
              },
            );
          }),
        catch: providerFailure,
      });
    });
  }

  #pump(): void {
    if (this.#closed || this.#retiring || this.#active || this.#queue.length === 0) return;
    if (!this.#host) {
      try {
        const host = this.#options.spawnHost();
        this.#host = host;
        const exited = Promise.withResolvers<void>();
        this.#exits.set(host, exited.promise);
        host.onMessage((message) => {
          if (this.#host === host) this.#message(message);
        });
        host.onExit(() => {
          exited.resolve();
          this.#exits.delete(host);
          if (this.#retiring === host) {
            this.#retiring = null;
            this.#pump();
          } else if (this.#host === host) this.#lost(host, true);
        });
        this.#startDeadline = setTimeout(() => this.#lost(host), this.#options.hostStartDeadlineMs ?? 30_000);
      } catch {
        for (const scan of this.#queue.splice(0)) this.#settle(scan, unavailable());
      }
      return;
    }
    if (!this.#ready) return;
    const scan = this.#queue.shift();
    if (!scan) return;
    this.#active = scan;
    try {
      this.#host.send({ kind: "scan", id: scan.id, options: scan.options, request: scan.request });
    } catch {
      this.#lost(this.#host);
    }
  }

  #message(message: ClaudeHistoryHostMessage): void {
    if (message.kind === "ready") {
      this.#ready = true;
      this.#clearStartDeadline();
      this.#pump();
      return;
    }
    const scan = this.#active;
    if (!scan || message.id !== scan.id) return;
    if (message.kind === "complete" || message.kind === "failed") {
      this.#settle(
        scan,
        message.kind === "failed"
          ? message.failure === "line-too-long"
            ? new LineTooLongError("Claude")
            : unavailable()
          : undefined,
      );
      this.#pump();
      return;
    }
    if (scan.consuming || message.sequence !== scan.sequence + 1) {
      this.#cancel(scan, unavailable());
      return;
    }
    scan.sequence = message.sequence;
    scan.consuming = true;
    const host = this.#host;
    scan.consumerDone = Effect.runPromise(Effect.result(Effect.suspend(() => scan.consume(message.fragment))), {
      signal: scan.signal,
    }).then(
      (result) => {
        if (this.#active !== scan || this.#host !== host || !host) return;
        if (Result.isFailure(result)) {
          this.#cancel(scan, result.failure.cause);
          return;
        }
        scan.consuming = false;
        try {
          host.send({ kind: "ack", id: scan.id, sequence: message.sequence, continue: result.success });
        } catch {
          this.#cancel(scan, unavailable());
        }
      },
      (failure) => this.#cancel(scan, failure),
    );
    const consumer = scan.consumerDone;
    this.#consumers.add(consumer);
    void consumer.finally(() => this.#consumers.delete(consumer));
  }

  #cancel(scan: Scan, failure: unknown): void {
    if (scan.settled) return;
    const queued = this.#queue.indexOf(scan);
    if (queued >= 0) this.#queue.splice(queued, 1);
    if (this.#active === scan) {
      const host = this.#host;
      this.#host = null;
      this.#ready = false;
      this.#clearStartDeadline();
      this.#settle(scan, failure);
      this.#retiring = host;
      host?.kill();
      this.#pump();
    } else {
      this.#settle(scan, failure);
    }
  }

  #lost(host: ClaudeHistoryHostProcess, exited = false): void {
    if (host !== this.#host) return;
    this.#host = null;
    this.#ready = false;
    this.#clearStartDeadline();
    if (this.#active) this.#settle(this.#active, unavailable());
    // Queued callers did not run. They fail too; only a new caller starts another host.
    for (const scan of this.#queue.splice(0)) this.#settle(scan, unavailable());
    if (!exited) {
      this.#retiring = host;
      host.kill();
    }
  }

  #settle(scan: Scan, failure?: unknown): void {
    if (scan.settled) return;
    scan.settled = true;
    if (this.#active === scan) this.#active = null;
    scan.detach();
    if (failure !== undefined) scan.controller.abort(failure);
    if (failure === undefined) scan.resolve();
    else scan.reject(failure);
  }

  #clearStartDeadline(): void {
    if (this.#startDeadline) clearTimeout(this.#startDeadline);
    this.#startDeadline = null;
  }
}

function unavailable(): Error {
  return new Error(sourceText("error.agent.historyUnavailable"));
}
