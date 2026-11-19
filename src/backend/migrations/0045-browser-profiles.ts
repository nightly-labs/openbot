import type { OpenBotMigration } from "./migration";

export const BROWSER_PROFILE_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS browser_profiles (
    profile_id TEXT NOT NULL PRIMARY KEY CHECK(length(profile_id) = 32),
    name TEXT NOT NULL,
    hue INTEGER NOT NULL CHECK(hue IN (0, 30, 55, 100, 150, 185, 215, 245, 280, 320)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;

export const migration: OpenBotMigration = {
  version: 45,
  name: "browser-profiles",
  up: (db) => db.exec(BROWSER_PROFILE_SCHEMA_SQL),
};
