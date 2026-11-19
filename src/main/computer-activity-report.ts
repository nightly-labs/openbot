import { Effect } from "effect";

const NO_PHONE_PAUSE_MS = 5 * 60_000;

export interface ComputerActivityReportOptions {
  awayAfterMs: number;
  idleSeconds(): number;
  targets(): readonly string[];
  send(serverId: string, idleSeconds: number): Effect.Effect<boolean, unknown>;
  run(operation: Effect.Effect<void>): void;
  now?: () => number;
}

interface ServerReport {
  sentAt: number | null;
  sending: boolean;
}

export class ComputerActivityReport {
  readonly #options: ComputerActivityReportOptions;
  readonly #now: () => number;
  readonly #checkMs: number;
  readonly #servers = new Map<string, ServerReport>();
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

  check(): void {
    const targets = new Set(this.#options.targets());
    for (const serverId of this.#servers.keys()) if (!targets.has(serverId)) this.#servers.delete(serverId);
    if (!targets.size) return;
    const idleSeconds = Math.max(0, Math.floor(this.#options.idleSeconds()));
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
