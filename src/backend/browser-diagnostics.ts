import type { BrowserActionHistoryEntry, BrowserDiagnosticEntry } from "@openbot/contracts/ipc";
import { redactText } from "@openbot/logging";

const DIAGNOSTIC_LIMIT = 100;
const ACTION_LIMIT = 100;
/**
 * A snapshot takes only the entries that no earlier snapshot delivered, and at most the most recent
 * of them: a single-page application that logs on each render would otherwise send the same network
 * log with every read. Each message is cut to a length that still names the failure.
 */
const SNAPSHOT_DIAGNOSTICS = 20;
const SNAPSHOT_ACTIONS = 10;
/** An action that returns a status, not a snapshot, reports this many new errors. */
const STATUS_ERRORS = 5;
const MAX_ENTRY_TEXT = 500;

/**
 * The bounded console/network/load and action rings for one browser tab. Every string here is
 * page-controlled text that `snapshot()` hands to a provider, so redaction happens on the way in
 * rather than at each reader: a page that logs `Authorization: Bearer …` never gets a secret into
 * the ring, and no later caller can forget to strip one.
 */
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

  /**
   * The entries no delivered snapshot has carried yet. Pass the cursor to `delivered` once the snapshot is
   * read. A successful request or a plain successful action tells the model nothing, so it is left out
   * before the limit: on a busy page they would fill the window and push out the error that matters.
   */
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

  /**
   * The newest errors that no snapshot and no earlier status delivered. The snapshot cursor stays, so the
   * next snapshot lists them too.
   */
  takeStatusErrors(): BrowserDiagnosticEntry[] {
    const undelivered = this.#addedDiagnostics - Math.max(this.#deliveredDiagnostics, this.#statusDiagnostics);
    this.#statusDiagnostics = this.#addedDiagnostics;
    return newest(this.#diagnostics, undelivered, DIAGNOSTIC_LIMIT)
      .filter((entry) => entry.level === "error")
      .slice(-STATUS_ERRORS);
  }

  /** A failed snapshot read does not call this, so the next snapshot still carries its entries. */
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

// Redact before cutting, so a cut cannot split a secret into a prefix the redactor no longer knows.
function boundedText(value: string): string {
  const redacted = redactText(value);
  return redacted.length > MAX_ENTRY_TEXT ? `${redacted.slice(0, MAX_ENTRY_TEXT)}…` : redacted;
}

function pushRing<T>(entries: T[], entry: T, limit: number): void {
  entries.push(entry);
  if (entries.length > limit) entries.splice(0, entries.length - limit);
}
