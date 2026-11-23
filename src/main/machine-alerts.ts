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
const REPEAT_MS = 24 * 60 * 60_000;
const CLEAR_MARGIN = 5;
const CPU_READINGS = 5;

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
  recipient: string | null;
}

export interface MachineAlertMonitorOptions {
  read: () => Effect.Effect<MachineMetrics>;
  display: () => Effect.Effect<MachineMetrics>;
  store: MachineAlertPreferenceStore;
  members: () => TeamMemberSummary[];
  onError: (message: string, error: unknown) => void;
}

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
          const recipient = this.#recipient(saved);
          for (const [metric, alert] of this.#active) {
            if (alert.recipient !== recipient || machineAlertLevel(saved, metric) !== alert.event.level)
              this.#active.delete(metric);
          }
        }),
      ),
    );
  }

  subscribe(listener: (memberId: string | null, event: MachineAlertEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  pending(memberId: string): MachineAlertEvent[] {
    if (this.#recipient(this.alerts()) !== memberId) return [];
    return [...this.#active.values()].filter((alert) => alert.recipient === memberId).map((alert) => alert.event);
  }

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
