ALTER TABLE marketplace_skills ADD COLUMN verified INTEGER NOT NULL DEFAULT 0 CHECK(verified IN (0, 1));

CREATE INDEX IF NOT EXISTS marketplace_skills_catalog_recent
ON marketplace_skills(updated_at DESC, id DESC)
WHERE approved_version_id IS NOT NULL;
