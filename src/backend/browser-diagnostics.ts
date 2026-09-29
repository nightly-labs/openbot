import type { BrowserActionHistoryEntry, BrowserDiagnosticEntry } from "@openbot/contracts/ipc";
import { redactText } from "@openbot/logging";

const DIAGNOSTIC_LIMIT = 100;
const ACTION_LIMIT = 100;
/**
 * Every snapshot, and so every action, hands these to the model again. A single-page application
 * that logs on each render fills the ring with long messages, so a snapshot takes the recent ones
 * and each message is cut to a length that still names the failure.
 */
const SNAPSHOT_DIAGNOSTICS = 20;
const SNAPSHOT_ACTIONS = 10;
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

  add(entry: Omit<BrowserDiagnosticEntry, "timestamp">): void {
    pushRing(
      this.#diagnostics,
      { ...entry, message: boundedText(entry.message), timestamp: new Date().toISOString() },
      DIAGNOSTIC_LIMIT,
    );
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
  }

  snapshot(): { diagnostics: BrowserDiagnosticEntry[]; actions: BrowserActionHistoryEntry[] } {
    return {
      diagnostics: this.#diagnostics.slice(-SNAPSHOT_DIAGNOSTICS),
      actions: this.#actions.slice(-SNAPSHOT_ACTIONS),
    };
  }

  clearDiagnostics(): void {
    this.#diagnostics.length = 0;
  }

  get errorCount(): number {
    return this.#diagnostics.filter((entry) => entry.level === "error").length;
  }
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
