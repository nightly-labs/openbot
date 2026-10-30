// Shared by migration v45 and the separate new-database schema. IF NOT EXISTS, because this text is
// both the migration and the tail of the latest schema.
//
// A browser profile is a named browser session on this computer. The id names the Chromium
// partition (`persist:openbot-browser-profile-<id>`); the name is only a label, so a rename moves no
// data. Configuration, written directly. Agents point at a profile from their `agent_json`, so no
// foreign key: a delete moves those agents to the shared session first. The hue is one of the agent
// avatar hues (`AVATAR_HUES`); the profile's labels use its color.
export const BROWSER_PROFILE_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS browser_profiles (
    profile_id TEXT NOT NULL PRIMARY KEY CHECK(length(profile_id) = 32),
    name TEXT NOT NULL,
    hue INTEGER NOT NULL CHECK(hue IN (0, 30, 55, 100, 150, 185, 215, 245, 280, 320)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;
