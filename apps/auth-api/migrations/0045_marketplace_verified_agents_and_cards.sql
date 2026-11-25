ALTER TABLE marketplace_agents ADD COLUMN verified INTEGER NOT NULL DEFAULT 0 CHECK(verified IN (0, 1));

ALTER TABLE marketplace_agent_versions ADD COLUMN card_key TEXT;
ALTER TABLE marketplace_skill_versions ADD COLUMN card_key TEXT;
