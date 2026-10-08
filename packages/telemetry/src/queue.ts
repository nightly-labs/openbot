import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect, Schema, Semaphore } from "effect";
import { type FailureProperties, isReportProfileId, type Report, type ReportContext, safeReport } from "./events";

export class TelemetryFailure extends Schema.TaggedError<TelemetryFailure>()("TelemetryFailure", {}) {}
export const telemetryIO = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: () => new TelemetryFailure() });
export interface ReportStorage {
  /** Cross-tab lock. The release function must always run. */
  acquire?(): Effect.Effect<() => void, TelemetryFailure>;
  read(): Effect.Effect<unknown, TelemetryFailure>;
  clear?(): Effect.Effect<void, TelemetryFailure>;
  write(value: unknown): Effect.Effect<void, TelemetryFailure>;
}
export type ReportTransport = (report: Report, signal: AbortSignal) => Effect.Effect<boolean, TelemetryFailure>;
export const REPORT_LIMIT = 1_000;
export const REPORT_BYTES = 1_048_576;
export const REPORT_TTL = 7 * 24 * 60 * 60 * 1_000;

/** Owns only safe reports. Application work never waits for this queue. */
export class ReportQueue {
  readonly #lock = Semaphore.makeUnsafe(1);
  #reports: Report[] = [];
  #unwritten: Report[] = [];
  #clearAll = false;
  #profileId: string | null = null;
  #enabled = false;
  #configured = false;
  #loaded = false;
  #generation = 0;
  #active = false;
  #closed = false;
  #closing = false;
  #retry = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #request: AbortController | undefined;

  constructor(
    readonly storage: ReportStorage,
    readonly transport: ReportTransport,
    readonly context: ReportContext,
    readonly now: () => number = Date.now,
    readonly random: () => number = Math.random,
    readonly makeId: () => string = () => crypto.randomUUID(),
  ) {}

  /** Invalidate scopes and abort immediately, before waiting for a storage write. */
  configure(enabled: boolean, profileId: string | null): Effect.Effect<void> {
    if (!isReportProfileId(profileId)) return this.configure(false, null);
    if (this.#closed || (this.#configured && this.#enabled === enabled && this.#profileId === profileId))
      return Effect.void;
    const first = !this.#configured;
    const previousProfile = this.#profileId;
    this.#configured = true;
    this.#enabled = enabled;
    this.#profileId = profileId;
    this.#generation += 1;
    const generation = this.#generation;
    this.#request?.abort();
    clearTimeout(this.#timer);
    this.#retry = 0;
    if (!enabled || (!first && previousProfile !== profileId)) this.#clearAll = true;
    return this.#locked(
      Effect.gen({ self: this }, function* () {
        if (generation !== this.#generation) return;
        if (!first || !enabled || profileId !== null) {
          this.#reports = [];
          this.#unwritten = [];
          this.#loaded = false;
        }
        yield* this.#clearStored();
      }),
    ).pipe(
      Effect.catch(() => Effect.void),
      Effect.andThen(() => this.flush()),
    );
  }

  scope(): { record: (name: Report["name"], properties: FailureProperties) => Effect.Effect<void> } {
    const generation = this.#generation;
    return {
      record: (name, properties) => (generation === this.#generation ? this.record(name, properties) : Effect.void),
    };
  }

  record(name: Report["name"], properties: FailureProperties, timestamp = this.now()): Effect.Effect<void> {
    if ((this.#configured && !this.#enabled) || this.#closed || this.#closing) return Effect.void;
    const generation = this.#generation;
    const report = safeReport({
      ...this.context,
      id: this.makeId(),
      timestamp: new Date(timestamp).toISOString(),
      profileId: this.#profileId,
      name,
      properties,
    });
    if (!report) return Effect.void;
    if (!this.#configured) {
      this.#unwritten.push(report);
      this.#unwritten = this.#bounded(this.#unwritten);
      return Effect.void;
    }
    return this.#locked(
      Effect.gen({ self: this }, function* () {
        if (generation !== this.#generation || !this.#enabled || this.#closed) return;
        this.#unwritten.push(report);
        this.#unwritten = this.#bounded(this.#unwritten);
        if (this.#loaded && !this.storage.acquire) this.#reports.push(report);
        yield* this.#load();
        if (generation !== this.#generation) return;
        this.#prune();
        yield* this.#persist();
      }),
    ).pipe(
      Effect.catch(() => Effect.void),
      Effect.andThen(() => (this.#timer ? Effect.void : this.flush())),
    );
  }

  readonly #load = Effect.fn("ReportQueue.load")(function* (this: ReportQueue) {
    yield* this.#clearStored();
    if (this.#loaded && !this.storage.acquire) return;
    const stored = yield* this.storage.read();
    this.#reports = [...this.#unwritten];
    if (
      isDynamicRecord(stored) &&
      stored.version === 1 &&
      stored.profileId === this.#profileId &&
      Array.isArray(stored.reports)
    ) {
      this.#reports = [
        ...stored.reports.flatMap((entry) => {
          const report = safeReport(entry);
          return report && report.profileId === this.#profileId && report.surface === this.context.surface
            ? [report]
            : [];
        }),
        ...this.#reports,
      ];
    }
    this.#loaded = true;
    this.#prune();
  });

  #bounded(reports: Report[]): Report[] {
    const now = this.now();
    const retained = reports.filter((report) => {
      const age = now - Date.parse(report.timestamp);
      return age >= 0 && age < REPORT_TTL;
    });
    while (
      retained.length > REPORT_LIMIT ||
      (retained.length &&
        new TextEncoder().encode(JSON.stringify({ version: 1, profileId: this.#profileId, reports: retained }))
          .byteLength > REPORT_BYTES)
    ) {
      let oldest = 0;
      for (let index = 1; index < retained.length; index++) {
        if ((retained[index]?.timestamp ?? "") < (retained[oldest]?.timestamp ?? "")) oldest = index;
      }
      retained.splice(oldest, 1);
    }
    return retained;
  }

  #prune(): void {
    this.#reports = this.#bounded(this.#reports);
  }

  #snapshot(): unknown {
    return { version: 1, profileId: this.#profileId, reports: this.#reports };
  }
  readonly #clearStored = Effect.fn("ReportQueue.clearStored")(function* (this: ReportQueue) {
    if (this.#clearAll) {
      yield* this.storage.clear?.() ?? this.storage.write({ version: 1, profileId: this.#profileId, reports: [] });
      this.#clearAll = false;
      this.#loaded = false;
    }
  });

  readonly #persist = Effect.fn("ReportQueue.persist")(function* (this: ReportQueue) {
    yield* this.storage.write(this.#snapshot());
    this.#unwritten = [];
  });

  #locked<A, E>(work: Effect.Effect<A, E>): Effect.Effect<A, E | TelemetryFailure> {
    return this.#lock.withPermit(
      this.storage.acquire
        ? Effect.acquireUseRelease(
            this.storage.acquire(),
            () => work,
            (release) => Effect.sync(release),
          )
        : work,
    );
  }

  /** Startup, online, foreground and retry callbacks all use this one sender. */
  readonly flush = Effect.fn("ReportQueue.flush")(function* (this: ReportQueue) {
    if (this.#active || !this.#enabled || this.#closed || this.#closing) return;
    this.#active = true;
    clearTimeout(this.#timer);
    this.#timer = undefined;
    const generation = this.#generation;
    yield* Effect.gen({ self: this }, function* () {
      while (this.#enabled && !this.#closed && !this.#closing && generation === this.#generation) {
        const sent = yield* this.#locked(
          Effect.gen({ self: this }, function* () {
            yield* this.#load();
            this.#prune();
            yield* this.#persist();
            const report = this.#reports[0];
            if (!report || generation !== this.#generation || !this.#enabled || this.#closed) return false;
            const controller = new AbortController();
            this.#request = controller;
            const accepted = yield* this.transport(report, controller.signal).pipe(
              Effect.timeout(10_000),
              Effect.catch(() => Effect.succeed(false)),
              Effect.ensuring(Effect.sync(() => controller.abort())),
            );
            if (generation !== this.#generation || this.#closed || !this.#enabled) return false;
            this.#reports = this.#reports.filter((entry) => entry.id !== report.id);
            // Keep refused reports until expiry, but let later reports send on the next attempt.
            if (!accepted) this.#reports.push(report);
            yield* this.#persist();
            if (!accepted) return yield* new TelemetryFailure();
            return true;
          }),
        );
        if (!sent) break;
        this.#retry = 0;
      }
    }).pipe(
      Effect.catch(() =>
        Effect.sync(() => {
          if (this.#enabled && !this.#closed && !this.#closing && generation === this.#generation) {
            const delay = Math.min(300_000, 1_000 * 2 ** Math.min(this.#retry++, 9)) * (0.75 + this.random() * 0.25);
            this.#timer = setTimeout(() => Effect.runFork(this.flush()), delay);
          }
        }),
      ),
      Effect.ensuring(
        Effect.sync(() => {
          this.#request = undefined;
          this.#active = false;
          if (generation !== this.#generation && this.#enabled && !this.#closed && !this.#closing)
            Effect.runFork(this.flush());
        }),
      ),
    );
  });

  close(): Effect.Effect<void> {
    this.#closing = true;
    if (!this.#configured) {
      this.#unwritten = [];
      this.#closed = true;
      return Effect.void;
    }
    this.#request?.abort();
    clearTimeout(this.#timer);
    return this.#locked(
      Effect.gen({ self: this }, function* () {
        yield* this.#load();
        this.#prune();
        yield* this.#persist();
      }),
    ).pipe(
      Effect.catch(() => Effect.void),
      Effect.ensuring(
        Effect.sync(() => {
          this.#closed = true;
        }),
      ),
    );
  }
}
