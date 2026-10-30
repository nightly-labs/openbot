import { randomBytes } from "node:crypto";
import { type AvatarHue, isAvatarHue } from "@openbot/contracts/ipc";
import type { DynamicRecord } from "@openbot/contracts/runtime-values";
import { databaseRows, requiredNumberColumn, requiredStringColumn } from "../database/database-rows";
import type { OpenBotDatabase } from "../openbot-database";

export interface BrowserProfileRecord {
  id: string;
  name: string;
  hue: AvatarHue;
}

/**
 * Owns the `browser_profiles` rows: the id, the name and the color of each named browser session. It does not
 * touch the Chromium data or the agents that use a profile. Configuration, so it writes directly,
 * as `MessagingStore` writes its role lists.
 */
export class BrowserProfileStore {
  readonly #database: OpenBotDatabase;

  constructor(database: OpenBotDatabase) {
    this.#database = database;
  }

  list(): BrowserProfileRecord[] {
    return databaseRows(
      this.#database.connection
        .prepare(
          "SELECT profile_id, name, hue FROM browser_profiles ORDER BY name COLLATE NOCASE, created_at, profile_id",
        )
        .all(),
    ).map(profileRecord);
  }

  get(id: string): BrowserProfileRecord | undefined {
    const [row] = databaseRows(
      this.#database.connection
        .prepare("SELECT profile_id, name, hue FROM browser_profiles WHERE profile_id = ?")
        .all(id),
    );
    return row === undefined ? undefined : profileRecord(row);
  }

  /** Adds a profile with a new random id. The caller checks the name. */
  create(name: string, hue: AvatarHue): BrowserProfileRecord {
    const id = randomBytes(16).toString("hex");
    const now = new Date().toISOString();
    this.#database.connection
      .prepare("INSERT INTO browser_profiles (profile_id, name, hue, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run(id, name, hue, now, now);
    return { id, name, hue };
  }

  rename(id: string, name: string): void {
    this.#database.connection
      .prepare("UPDATE browser_profiles SET name = ?, updated_at = ? WHERE profile_id = ?")
      .run(name, new Date().toISOString(), id);
  }

  setHue(id: string, hue: AvatarHue): void {
    this.#database.connection
      .prepare("UPDATE browser_profiles SET hue = ?, updated_at = ? WHERE profile_id = ?")
      .run(hue, new Date().toISOString(), id);
  }

  delete(id: string): void {
    this.#database.connection.prepare("DELETE FROM browser_profiles WHERE profile_id = ?").run(id);
  }
}

function profileRecord(row: DynamicRecord): BrowserProfileRecord {
  // The column CHECK keeps the hue in the list.
  const hue = requiredNumberColumn(row, "hue");
  if (!isAvatarHue(hue)) throw new Error("Invalid browser profile hue.");
  return { id: requiredStringColumn(row, "profile_id"), name: requiredStringColumn(row, "name"), hue };
}
