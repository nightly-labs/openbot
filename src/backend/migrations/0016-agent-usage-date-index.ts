import type { OpenBotMigration } from "./migration";

export const ANALYTICS_DATE_INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS agent_usage_occurred ON agent_usage_records(occurred_at);
  CREATE INDEX IF NOT EXISTS agent_usage_activity_occurred ON agent_usage_activity(occurred_at);
`;

export const migration: OpenBotMigration = {
  version: 16,
  name: "agent-usage-date-index",
  up: (db) => db.exec(ANALYTICS_DATE_INDEX_SQL),
};
