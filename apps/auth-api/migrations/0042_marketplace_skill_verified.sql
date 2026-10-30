-- OpenBot checked the skill beyond the listing review. Only an admin sets it, as featured. The Worker
-- that runs before this deploy does not read the column, and its inserts get the default 0.
ALTER TABLE marketplace_skills ADD COLUMN verified INTEGER NOT NULL DEFAULT 0 CHECK(verified IN (0, 1));

-- The `sort=updated` order of the catalog: the latest update first, with no featured skills first.
CREATE INDEX IF NOT EXISTS marketplace_skills_catalog_recent
ON marketplace_skills(updated_at DESC, id DESC)
WHERE approved_version_id IS NOT NULL;
