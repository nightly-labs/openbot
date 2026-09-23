import { readFile } from "node:fs/promises";
import type { NotificationPreference } from "@openbot/contracts/ipc";
import { isBoolean, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { writeJsonFileAtomically } from "../backend/atomic-json-file";

const DEFAULT_PREFERENCE: NotificationPreference = { desktopNotifications: true };

interface StoredNotificationPreference extends NotificationPreference {
  /** Whether OpenBot has already shown the notification that makes macOS ask for permission. */
  permissionRequested: boolean;
}

/**
 * The desktop notification switch. Main reads it for every agent event, so it is held in memory
 * after `load` rather than read from disk each time.
 *
 * Writes are chained for the reason `update-preference-store.ts` chains its own: each one renames its
 * own temporary file into place, and an earlier rename that lands last would persist the value the
 * user just changed.
 */
export class NotificationPreferenceStore {
  readonly #path: string;
  #stored: StoredNotificationPreference = { ...DEFAULT_PREFERENCE, permissionRequested: false };
  #pendingWrite: Promise<unknown> = Promise.resolve();

  constructor(path: string) {
    this.#path = path;
  }

  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.#path, "utf8"));
      if (isDynamicRecord(parsed) && parsed.version === 1 && isBoolean(parsed.desktopNotifications)) {
        this.#stored = {
          desktopNotifications: parsed.desktopNotifications,
          // Absent in files from builds before the request, which never asked.
          permissionRequested: parsed.permissionRequested === true,
        };
      }
    } catch (error) {
      if (!isMissing(error) && !(error instanceof SyntaxError)) throw error;
    }
  }

  get(): NotificationPreference {
    return { desktopNotifications: this.#stored.desktopNotifications };
  }

  permissionRequested(): boolean {
    return this.#stored.permissionRequested;
  }

  async set({ desktopNotifications }: NotificationPreference): Promise<NotificationPreference> {
    await this.#write((stored) => ({ ...stored, desktopNotifications }));
    return this.get();
  }

  async markPermissionRequested(): Promise<void> {
    await this.#write((stored) => ({ ...stored, permissionRequested: true }));
  }

  #write(change: (stored: StoredNotificationPreference) => StoredNotificationPreference): Promise<void> {
    // The change reads the stored value when its turn comes, so a queued write keeps the field the
    // write before it changed.
    const write = this.#pendingWrite.then(
      () => this.#replace(change(this.#stored)),
      () => this.#replace(change(this.#stored)),
    );
    this.#pendingWrite = write.catch(() => undefined);
    return write;
  }

  async #replace(stored: StoredNotificationPreference): Promise<void> {
    await writeJsonFileAtomically(this.#path, { version: 1, ...stored });
    this.#stored = stored;
  }
}

function isMissing(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
