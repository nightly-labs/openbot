ALTER TABLE hosted_servers ADD COLUMN storage_tier INTEGER NOT NULL DEFAULT 0 CHECK (storage_tier IN (0, 1, 2));
