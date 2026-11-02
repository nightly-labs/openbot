-- OpenBot checked the agent beyond the listing review, as `marketplace_skills.verified`. Only an admin
-- sets it. The Worker that runs before this deploy does not read the column, and its inserts get the
-- default 0.
ALTER TABLE marketplace_agents ADD COLUMN verified INTEGER NOT NULL DEFAULT 0 CHECK(verified IN (0, 1));

-- The share card of a listing version: a 1200 × 630 PNG in R2 that the reviewer's script draws when it
-- approves the version. Null until then, and for every version the old Worker inserts.
ALTER TABLE marketplace_agent_versions ADD COLUMN card_key TEXT;
ALTER TABLE marketplace_skill_versions ADD COLUMN card_key TEXT;
