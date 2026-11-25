import type { BrowserActionHistoryEntry, BrowserDiagnosticEntry } from "@openbot/contracts/ipc";
import { redactText } from "@openbot/logging";

const DIAGNOSTIC_LIMIT = 100;
const ACTION_LIMIT = 100;
const SNAPSHOT_DIAGNOSTICS = 20;
const SNAPSHOT_ACTIONS = 10;
const STATUS_ERRORS = 5;
const MAX_ENTRY_TEXT = 500;

export class BrowserDiagnostics {
  readonly #diagnostics: BrowserDiagnosticEntry[] = [];
  readonly #actions: BrowserActionHistoryEntry[] = [];
  #addedDiagnostics = 0;
  #addedActions = 0;
  #deliveredDiagnostics = 0;
  #deliveredActions = 0;
  #statusDiagnostics = 0;

  add(entry: Omit<BrowserDiagnosticEntry, "timestamp">): void {
    pushRing(
      this.#diagnostics,
      { ...entry, message: boundedText(entry.message), timestamp: new Date().toISOString() },
      DIAGNOSTIC_LIMIT,
    );
    this.#addedDiagnostics += 1;
  }

  action(entry: Omit<BrowserActionHistoryEntry, "timestamp">): void {
    pushRing(
      this.#actions,
      {
        ...entry,
        ...(entry.target === undefined ? {} : { target: boundedText(entry.target) }),
        ...(entry.detail === undefined ? {} : { detail: boundedText(entry.detail) }),
        timestamp: new Date().toISOString(),
      },
      ACTION_LIMIT,
    );
    this.#addedActions += 1;
  }

  snapshot(): {
    diagnostics: BrowserDiagnosticEntry[];
    actions: BrowserActionHistoryEntry[];
    cursor: BrowserHistoryCursor;
  } {
    return {
      diagnostics: newest(this.#diagnostics, this.#addedDiagnostics - this.#deliveredDiagnostics, DIAGNOSTIC_LIMIT)
        .filter((entry) => entry.kind !== "network" || entry.level !== "info")
        .slice(-SNAPSHOT_DIAGNOSTICS),
      actions: newest(this.#actions, this.#addedActions - this.#deliveredActions, ACTION_LIMIT)
        .filter((entry) => entry.outcome !== "success" || entry.detail)
        .slice(-SNAPSHOT_ACTIONS),
      cursor: { diagnostics: this.#addedDiagnostics, actions: this.#addedActions },
    };
  }

  takeStatusErrors(): BrowserDiagnosticEntry[] {
    const undelivered = this.#addedDiagnostics - Math.max(this.#deliveredDiagnostics, this.#statusDiagnostics);
    this.#statusDiagnostics = this.#addedDiagnostics;
    return newest(this.#diagnostics, undelivered, DIAGNOSTIC_LIMIT)
      .filter((entry) => entry.level === "error")
      .slice(-STATUS_ERRORS);
  }

  delivered(cursor: BrowserHistoryCursor): void {
    this.#deliveredDiagnostics = Math.max(this.#deliveredDiagnostics, cursor.diagnostics);
    this.#deliveredActions = Math.max(this.#deliveredActions, cursor.actions);
  }

  clearDiagnostics(): void {
    this.#diagnostics.length = 0;
  }

  get errorCount(): number {
    return this.#diagnostics.filter((entry) => entry.level === "error").length;
  }
}

export interface BrowserHistoryCursor {
  readonly diagnostics: number;
  readonly actions: number;
}

function newest<T>(entries: T[], undelivered: number, limit: number): T[] {
  return undelivered > 0 ? entries.slice(-Math.min(undelivered, limit)) : [];
}

function boundedText(value: string): string {
  const redacted = redactText(value);
  return redacted.length > MAX_ENTRY_TEXT ? `${redacted.slice(0, MAX_ENTRY_TEXT)}…` : redacted;
}

function pushRing<T>(entries: T[], entry: T, limit: number): void {
  entries.push(entry);
  if (entries.length > limit) entries.splice(0, entries.length - limit);
}
