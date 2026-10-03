import type { HostedServerActivityReport } from "@openbot/contracts/hosted-servers";
import { Deferred, Effect } from "effect";
import { type RemoteWorkflowError, runRemoteWorkflow } from "./remote-service-effects";

/**
 * A hosted server tells the Worker that it is in use (a client works with it or an agent works) and
 * when its next routine runs. With no use for 15 minutes, the Worker stops the server and keeps its data.
 * The next client, or the next routine run, starts it again.
 */
const SAMPLE_INTERVAL_MS = 60_000;
/**
 * A server in use reports at most this often. The Worker stops a server after 15 minutes with no report,
 * so a report can be 6 minutes old and the server still runs.
 */
const REPORT_INTERVAL_MS = 5 * 60_000;
/**
 * A connected client counts as use until this long after its last send, change or typing event. One
 * report interval, so that each action reaches the Worker. An app that is only open, or that only reads,
 * does not keep the server running: it stops 15 to 25 minutes after the last action.
 */
export const CLIENT_USE_WINDOW_MS = REPORT_INTERVAL_MS;

export interface HostedServerActivityOptions {
  hostId: string;
  inUse: () => boolean;
  /** The next routine run in milliseconds since the epoch, or null for none. */
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
  /** Undefined until the first report, so that the first sample always sends the next run. */
  #reportedNextRunAt: number | null | undefined;

  constructor(options: HostedServerActivityOptions) {
    this.#options = options;
  }

  start(): void {
    if (this.#timer) return;
    this.#timer = setInterval(() => {
      void runRemoteWorkflow(this.tick()).catch((error) =>
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
    // The first use after a pause is sent at once: the last report can be close to 15 minutes old.
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
    // A failed report changes nothing here, so the next sample sends it again.
    this.#wasInUse = inUse;
    this.#reportedNextRunAt = nextRunAt;
    if (inUse) this.#lastInUseReportAt = now;
  });
}
