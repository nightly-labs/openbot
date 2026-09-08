ALTER TABLE marketplace_agent_versions ADD COLUMN category TEXT NOT NULL DEFAULT 'other';
ALTER TABLE marketplace_agents ADD COLUMN show_creator_avatar INTEGER NOT NULL DEFAULT 0 CHECK(show_creator_avatar IN (0, 1));
ALTER TABLE marketplace_skills ADD COLUMN show_creator_avatar INTEGER NOT NULL DEFAULT 0 CHECK(show_creator_avatar IN (0, 1));
CREATE INDEX marketplace_agent_versions_category ON marketplace_agent_versions(category, agent_id);
