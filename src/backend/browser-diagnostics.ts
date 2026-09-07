import type { BrowserActionHistoryEntry, BrowserDiagnosticEntry } from "@openbot/contracts/ipc";
import { redactText } from "@openbot/logging";

const DIAGNOSTIC_LIMIT = 100;
const ACTION_LIMIT = 100;

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
      { ...entry, message: redactText(entry.message), timestamp: new Date().toISOString() },
      DIAGNOSTIC_LIMIT,
    );
  }

  action(entry: Omit<BrowserActionHistoryEntry, "timestamp">): void {
    pushRing(
      this.#actions,
      {
        ...entry,
        ...(entry.target === undefined ? {} : { target: redactText(entry.target) }),
        ...(entry.detail === undefined ? {} : { detail: redactText(entry.detail) }),
        timestamp: new Date().toISOString(),
      },
      ACTION_LIMIT,
    );
  }

  snapshot(): { diagnostics: BrowserDiagnosticEntry[]; actions: BrowserActionHistoryEntry[] } {
    return { diagnostics: this.#diagnostics.slice(-50), actions: this.#actions.slice(-50) };
  }

  clearDiagnostics(): void {
    this.#diagnostics.length = 0;
  }

  get errorCount(): number {
    return this.#diagnostics.filter((entry) => entry.level === "error").length;
  }
}

function pushRing<T>(entries: T[], entry: T, limit: number): void {
  entries.push(entry);
  if (entries.length > limit) entries.splice(0, entries.length - limit);
}
