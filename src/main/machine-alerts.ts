import {
  canAdministerServer,
  DEFAULT_MACHINE_ALERT_SETTINGS,
  decodeMachineAlertSettings,
  MACHINE_METRICS,
  type MachineAlertSettings,
  type MachineMetric,
  type MachineMetrics,
  machineAlertLevel,
  machineMetricRatio,
  type TeamMemberSummary,
} from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { MACHINE_ALERT_EVENT, type MachineAlertEvent } from "@openbot/contracts/team-protocol/machine-resources-v1";
import { Effect, Result, Semaphore } from "effect";
import { isMissingFileError } from "../backend/file-errors";
import { type PreferenceFileFailure, readPreferenceFile, writePreferenceFile } from "./preference-file";

export const MACHINE_ALERTS_PREFERENCE_FILE = "openbot-machine-alerts-v1.json";

const CHECK_INTERVAL_MS = 60_000;
/** An alert that stays above its level is sent again once a day. */
const REPEAT_MS = 24 * 60 * 60_000;
/** The use must go this many points below the level before the alert ends, so a value at the level does not flap. */
const CLEAR_MARGIN = 5;
/** A short CPU peak is normal work. CPU alerts after this many readings above the level, one a minute. */
const CPU_READINGS = 5;

/**
 * The machine alert levels and the member who gets the alert. A missing or unreadable file reads as
 * the defaults. Writes are chained for the reason `update-preference-store.ts` chains its own.
 */
export class MachineAlertPreferenceStore {
  readonly #path: string;
  #settings: MachineAlertSettings = { ...DEFAULT_MACHINE_ALERT_SETTINGS };
  #writes = Semaphore.makeUnsafe(1);

  constructor(path: string) {
    this.#path = path;
  }

  load(): Effect.Effect<void, PreferenceFileFailure> {
    return Effect.gen({ self: this }, function* () {
      const loaded = yield* Effect.result(
        readPreferenceFile(this.#path, (parsed): MachineAlertSettings | null => {
          if (!isDynamicRecord(parsed) || parsed.version !== 1) return null;
          try {
            return decodeMachineAlertSettings(parsed);
          } catch {
            return null;
          }
        }),
      );
      if (Result.isSuccess(loaded)) {
        if (loaded.success) this.#settings = loaded.success;
      } else if (!isMissingFileError(loaded.failure.cause) && !(loaded.failure.cause instanceof SyntaxError))
        return yield* loaded.failure;
    });
  }

  get(): MachineAlertSettings {
    return { ...this.#settings };
  }

  readonly set = Effect.fn("MachineAlertPreference.set")(function* (
    this: MachineAlertPreferenceStore,
    settings: MachineAlertSettings,
  ) {
    yield* this.#writes.withPermit(
      Effect.uninterruptible(
        writePreferenceFile(this.#path, { version: 1, ...settings }).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              this.#settings = { ...settings };
            }),
          ),
        ),
      ),
    );
    return this.get();
  });
}

interface ActiveAlert {
  event: MachineAlertEvent;
  sentAt: number;
  /** The member it went to. Null: the user of this computer, on a server with no members yet. */
  recipient: string | null;
}

export interface MachineAlertMonitorOptions {
  /** The reading of the once-a-minute check. */
  read: () => Effect.Effect<MachineMetrics>;
  /** The reading of Server settings, from its own sampler, so its reads do not move the check's CPU window. */
  display: () => Effect.Effect<MachineMetrics>;
  store: MachineAlertPreferenceStore;
  members: () => TeamMemberSummary[];
  onError: (message: string, error: unknown) => void;
}

/**
 * Reads the machine once a minute and alerts the responsible member when a metric passes its level.
 * Each alert goes to that member's devices (`subscribe`). A device that connects while the use is
 * still above the level gets it too (`pending`); a client shows each `alertId` once.
 */
export class MachineAlertMonitor {
  readonly #options: MachineAlertMonitorOptions;
  readonly #active = new Map<MachineMetric, ActiveAlert>();
  readonly #listeners = new Set<(memberId: string | null, event: MachineAlertEvent) => void>();
  #cpuReadingsAbove = 0;
  #timer: ReturnType<typeof setInterval> | null = null;
  #checking = false;

  constructor(options: MachineAlertMonitorOptions) {
    this.#options = options;
  }

  start(): void {
    if (this.#timer) return;
    this.#timer = setInterval(() => void this.#check(), CHECK_INTERVAL_MS);
    this.#timer.unref();
    void this.#check();
  }

  close(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    this.#listeners.clear();
  }

  metrics(): Effect.Effect<MachineMetrics> {
    return this.#options.display();
  }

  alerts(): MachineAlertSettings {
    return this.#options.store.get();
  }

  /** An owner or admin who can sign in. A member who is not one cannot act on a full disk. */
  canBeResponsible(memberId: string | null): boolean {
    return (
      memberId === null ||
      this.#options
        .members()
        .some((member) => member.id === memberId && !member.disabled && canAdministerServer(member.role))
    );
  }

  setAlerts(settings: MachineAlertSettings): Effect.Effect<MachineAlertSettings, PreferenceFileFailure> {
    return this.#options.store.set(settings).pipe(
      Effect.tap((saved) =>
        Effect.sync(() => {
          // A new member or level starts again: the next reading alerts the new member when the use is still high.
          const recipient = this.#recipient(saved);
          for (const [metric, alert] of this.#active) {
            if (alert.recipient !== recipient || machineAlertLevel(saved, metric) !== alert.event.level)
              this.#active.delete(metric);
          }
        }),
      ),
    );
  }

  /**
   * Called with each alert for the member who gets it. Null: the server has no members yet, so the
   * user of this computer gets it.
   */
  subscribe(listener: (memberId: string | null, event: MachineAlertEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** The alerts in force for `memberId`, for a device of theirs that connects. */
  pending(memberId: string): MachineAlertEvent[] {
    // A member who is no longer the responsible admin gets nothing; the next reading alerts the new one.
    if (this.#recipient(this.alerts()) !== memberId) return [];
    return [...this.#active.values()].filter((alert) => alert.recipient === memberId).map((alert) => alert.event);
  }

  /** The responsible member, or the owner when the member is not an admin any more or was never set. */
  #recipient(settings: MachineAlertSettings): string | null {
    const members = this.#options.members();
    const responsible = members.find(
      (member) => member.id === settings.responsibleMemberId && !member.disabled && canAdministerServer(member.role),
    );
    return (responsible ?? members.find((member) => member.role === "owner"))?.id ?? null;
  }

  async #check(): Promise<void> {
    if (this.#checking) return;
    this.#checking = true;
    try {
      const metrics = await Effect.runPromise(this.#options.read());
      this.#evaluate(metrics, Date.now());
    } catch (error) {
      this.#options.onError("The machine alert check failed.", error);
    } finally {
      this.#checking = false;
    }
  }

  #evaluate(metrics: MachineMetrics, now: number): void {
    const settings = this.alerts();
    for (const metric of MACHINE_METRICS) {
      const ratio = machineMetricRatio(metrics, metric);
      if (ratio === null) continue;
      const percent = Math.floor(ratio * 100);
      const level = machineAlertLevel(settings, metric);
      if (metric === "cpu") this.#cpuReadingsAbove = percent >= level ? this.#cpuReadingsAbove + 1 : 0;
      const active = this.#active.get(metric);
      if (percent < level - CLEAR_MARGIN) {
        this.#active.delete(metric);
        continue;
      }
      if (percent < level || (metric === "cpu" && this.#cpuReadingsAbove < CPU_READINGS)) continue;
      const recipient = this.#recipient(settings);
      // A new responsible member, or an owner after a demotion, gets an alert in force at once.
      if (active && active.recipient === recipient && now - active.sentAt < REPEAT_MS) continue;
      const event: MachineAlertEvent = {
        type: MACHINE_ALERT_EVENT,
        alertId: `${metric}-${now}`,
        metric,
        percent,
        level,
      };
      this.#active.set(metric, { event, sentAt: now, recipient });
      for (const listener of this.#listeners) listener(recipient, event);
    }
  }
}
