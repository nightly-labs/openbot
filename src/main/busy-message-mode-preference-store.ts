import { readFile } from "node:fs/promises";
import { type BusyMessageModePreference, DEFAULT_BUSY_MESSAGE_MODE, isBusyMessageMode } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { writeJsonFileAtomically } from "../backend/atomic-json-file";
import { isMissingFileError } from "../backend/file-errors";

/**
 * The app default for a message sent to a busy agent. The backend reads it for each such message,
 * so it is held in memory after `load` rather than read from disk each time.
 *
 * A file that is missing, unreadable as JSON or names an unknown mode reads as `queue`, which is
 * what every message did before the setting existed. Writes are chained for the reason
 * `update-preference-store.ts` chains its own: an earlier rename that lands last would persist the
 * value the user just changed.
 */
export class BusyMessageModePreferenceStore {
  readonly #path: string;
  #preference: BusyMessageModePreference = { mode: DEFAULT_BUSY_MESSAGE_MODE };
  #pendingWrite: Promise<unknown> = Promise.resolve();

  constructor(path: string) {
    this.#path = path;
  }

  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.#path, "utf8"));
      if (isDynamicRecord(parsed) && parsed.version === 1 && isBusyMessageMode(parsed.mode)) {
        this.#preference = { mode: parsed.mode };
      }
    } catch (error) {
      if (!isMissingFileError(error) && !(error instanceof SyntaxError)) throw error;
    }
  }

  get(): BusyMessageModePreference {
    return { ...this.#preference };
  }

  set(preference: BusyMessageModePreference): Promise<BusyMessageModePreference> {
    const write = this.#pendingWrite.then(
      () => this.#replace(preference),
      () => this.#replace(preference),
    );
    this.#pendingWrite = write.catch(() => undefined);
    return write;
  }

  async #replace(preference: BusyMessageModePreference): Promise<BusyMessageModePreference> {
    await writeJsonFileAtomically(this.#path, { version: 1, mode: preference.mode });
    this.#preference = { mode: preference.mode };
    return this.get();
  }
}
