import { Effect } from "effect";

/** A host that sends notifications to no phone of the member is told again only after this time. */
const NO_PHONE_PAUSE_MS = 5 * 60_000;

export interface ComputerActivityReportOptions {
  /** The time without input after which a host lets the member's phone notify. */
  awayAfterMs: number;
  /** Whole seconds since the last keyboard or mouse input on this computer, in any app. */
  idleSeconds(): number;
  /** The servers to tell now: online, with `computer-activity-v1`, and their events shown on this desktop. */
  targets(): readonly string[];
  /** Tells a host the idle time. Succeeds with whether the host notifies a phone of the member. */
  send(serverId: string, idleSeconds: number): Effect.Effect<boolean, unknown>;
  /** Runs a send in the scope of its owner. */
  run(operation: Effect.Effect<void>): void;
  now?: () => number;
}

interface ServerReport {
  /** The time of the last send, or `null` before one and after a failed one. */
  sentAt: number | null;
  sending: boolean;
}

/**
 * Tells each joined host when this computer had input (`computer-activity-v1`), so the member's phones
 * stay quiet while the member is at the computer, also in another app. It reads the idle time of the
 * computer at a short interval and sends only when there was input after the last send. The last send
 * after the member leaves gives the time of the last input, so the host knows when the member left.
 */
export class ComputerActivityReport {
  readonly #options: ComputerActivityReportOptions;
  readonly #now: () => number;
  /** Shorter than the away time, so the host's input time is never older than that time while the member works. */
  readonly #checkMs: number;
  readonly #servers = new Map<string, ServerReport>();
  /**
   * The end of the pause of each host that answered that it notifies no phone of the member. It stays
   * when the host stops being a target, so a focus change does not end it.
   */
  readonly #pausedUntil = new Map<string, number>();
  #timer: ReturnType<typeof setInterval> | null = null;

  constructor(options: ComputerActivityReportOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
    this.#checkMs = Math.min(5_000, Math.max(1_000, Math.floor(options.awayAfterMs / 6)));
  }

  start(): void {
    if (this.#timer) return;
    this.#timer = setInterval(() => this.check(), this.#checkMs);
  }

  dispose(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    this.#servers.clear();
    this.#pausedUntil.clear();
  }

  /** Sends the idle time to each target that has not had it since the last input. */
  check(): void {
    const targets = new Set(this.#options.targets());
    for (const serverId of this.#servers.keys()) if (!targets.has(serverId)) this.#servers.delete(serverId);
    if (!targets.size) return;
    const idleSeconds = Math.max(0, Math.floor(this.#options.idleSeconds()));
    // The member is away already, and the last send gave the time of the last input.
    if (idleSeconds * 1_000 >= this.#options.awayAfterMs) return;
    const now = this.#now();
    for (const [serverId, until] of this.#pausedUntil) if (until <= now) this.#pausedUntil.delete(serverId);
    for (const serverId of targets) {
      let report = this.#servers.get(serverId);
      if (!report) {
        report = { sentAt: null, sending: false };
        this.#servers.set(serverId, report);
      }
      if (report.sending || this.#pausedUntil.has(serverId)) continue;
      // No input since the last send: the host has the time of the last input.
      if (report.sentAt !== null && idleSeconds * 1_000 >= now - report.sentAt) continue;
      const current = report;
      current.sending = true;
      current.sentAt = now;
      this.#options.run(
        this.#options.send(serverId, idleSeconds).pipe(
          Effect.match({
            onSuccess: (phones) => {
              current.sending = false;
              if (!phones) this.#pausedUntil.set(serverId, this.#now() + NO_PHONE_PAUSE_MS);
            },
            onFailure: () => {
              current.sending = false;
              current.sentAt = null;
            },
          }),
        ),
      );
    }
  }
}
