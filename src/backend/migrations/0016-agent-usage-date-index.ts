import type { OpenBotMigration } from "./migration";

// A host-wide report constrains the date and nothing else, and an index that leads with
// `agent_id` cannot serve a range over `occurred_at` alone - so every such report used to
// scan all retained history, and a report open across turn completions repeated that scan.
// The date-leading pair is what a host read seeks on; `agent_usage_date` and
// `agent_usage_activity_date` still serve a report filtered to one agent.
//
// A separate constant, and migration 16 rather than an edit to 15: a database that already
// ran 15 - every development profile on this machine - would otherwise never meet the index.
export const ANALYTICS_DATE_INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS agent_usage_occurred ON agent_usage_records(occurred_at);
  CREATE INDEX IF NOT EXISTS agent_usage_activity_occurred ON agent_usage_activity(occurred_at);
`;

export const migration: OpenBotMigration = {
  version: 16,
  name: "agent-usage-date-index",
  up: (db) => db.exec(ANALYTICS_DATE_INDEX_SQL),
};
