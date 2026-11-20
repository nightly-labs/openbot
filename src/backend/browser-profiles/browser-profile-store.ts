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
  const hue = requiredNumberColumn(row, "hue");
  if (!isAvatarHue(hue)) throw new Error("Invalid browser profile hue.");
  return { id: requiredStringColumn(row, "profile_id"), name: requiredStringColumn(row, "name"), hue };
}
