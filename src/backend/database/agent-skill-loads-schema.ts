// Shared by migration v58 and the separate new-database schema. IF NOT EXISTS throughout.
//
// One row for each time an agent loaded a skill, for the Skill tab of the usage report. The CLI loads
// the skill itself, so a row comes from the finished tool step that read its SKILL.md or called the
// Skill tool. `tokens` is an estimate from the size of that SKILL.md, null when the file was not found;
// `estimated_cost_usd` prices those tokens as input of the turn's model, null when the model has no
// list price. Like the other usage rows, a row stays when its conversation is deleted and goes with
// its agent.
export const AGENT_SKILL_LOADS_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS agent_usage_skill_loads (
    agent_id TEXT NOT NULL,
    load_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    turn_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    skill TEXT NOT NULL CHECK(length(skill) BETWEEN 1 AND 128),
    tokens INTEGER CHECK(tokens IS NULL OR tokens >= 0),
    estimated_cost_usd REAL CHECK(estimated_cost_usd IS NULL OR estimated_cost_usd >= 0),
    occurred_at TEXT NOT NULL,
    PRIMARY KEY(agent_id, load_id)
  );
  CREATE INDEX IF NOT EXISTS agent_usage_skill_loads_date ON agent_usage_skill_loads(agent_id, occurred_at);
  CREATE INDEX IF NOT EXISTS agent_usage_skill_loads_occurred ON agent_usage_skill_loads(occurred_at);
`;
