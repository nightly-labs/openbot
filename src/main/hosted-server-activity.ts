import type { HostedServerActivityReport } from "@openbot/contracts/hosted-servers";
import { Deferred, Effect } from "effect";
import { runCauseEffect } from "../backend/effect-boundary";
import type { RemoteWorkflowError } from "./remote-service-effects";

const SAMPLE_INTERVAL_MS = 60_000;
const REPORT_INTERVAL_MS = 5 * 60_000;
export const CLIENT_USE_WINDOW_MS = REPORT_INTERVAL_MS;

export interface HostedServerActivityOptions {
  hostId: string;
  inUse: () => boolean;
  nextRunAt: () => number | null;
  report: (path: string, report: HostedServerActivityReport) => Effect.Effect<unknown, RemoteWorkflowError>;
  onError: (message: string, error: unknown) => void;
  now?: () => number;
}

export class HostedServerActivity {
  readonly #options: HostedServerActivityOptions;
  #timer: ReturnType<typeof setInterval> | null = null;
  #pending: Deferred.Deferred<void, RemoteWorkflowError> | null = null;
  #wasInUse = false;
  #lastInUseReportAt: number | null = null;
  #reportedNextRunAt: number | null | undefined;

  constructor(options: HostedServerActivityOptions) {
    this.#options = options;
  }

  start(): void {
    if (this.#timer) return;
    this.#timer = setInterval(() => {
      void runCauseEffect(this.tick()).catch((error) =>
        this.#options.onError("The hosted server activity report failed.", error),
      );
    }, SAMPLE_INTERVAL_MS);
    this.#timer.unref();
  }

  stop(): Effect.Effect<void> {
    return Effect.suspend(() => {
      if (this.#timer) clearInterval(this.#timer);
      this.#timer = null;
      return this.#pending ? Deferred.await(this.#pending).pipe(Effect.catch(() => Effect.void)) : Effect.void;
    });
  }

  tick(): Effect.Effect<void, RemoteWorkflowError> {
    return Effect.suspend(() => {
      if (this.#pending) return Deferred.await(this.#pending);
      const pending = Deferred.makeUnsafe<void, RemoteWorkflowError>();
      this.#pending = pending;
      return this.#tickEffect().pipe(
        Effect.onExit((exit) =>
          Effect.gen({ self: this }, function* () {
            this.#pending = null;
            yield* Deferred.done(pending, exit);
          }),
        ),
      );
    }).pipe(Effect.uninterruptible);
  }

  readonly #tickEffect = Effect.fn("HostedServerActivity.tick")(function* (this: HostedServerActivity) {
    const now = this.#options.now?.() ?? Date.now();
    const inUse = this.#options.inUse();
    const nextRunAt = this.#options.nextRunAt();
    const useDue =
      inUse &&
      (!this.#wasInUse || this.#lastInUseReportAt === null || now - this.#lastInUseReportAt >= REPORT_INTERVAL_MS);
    if (!useDue && nextRunAt === this.#reportedNextRunAt) {
      this.#wasInUse = inUse;
      return;
    }
    yield* this.#options.report(`/v2/hosting/servers/${encodeURIComponent(this.#options.hostId)}/activity`, {
      inUse,
      nextRunAt,
    });
    this.#wasInUse = inUse;
    this.#reportedNextRunAt = nextRunAt;
    if (inUse) this.#lastInUseReportAt = now;
  });
}
