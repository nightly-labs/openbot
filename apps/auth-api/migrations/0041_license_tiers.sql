ALTER TABLE hosted_servers ADD COLUMN legacy_member_limits INTEGER NOT NULL DEFAULT 1
  CHECK (legacy_member_limits IN (0, 1));

ALTER TABLE licenses ADD COLUMN tier TEXT CHECK (tier IS NULL OR tier IN ('starter', 'team'));
ALTER TABLE licenses ADD COLUMN billing_interval TEXT
  CHECK (billing_interval IS NULL OR billing_interval IN ('month', 'year'));
ALTER TABLE licenses ADD COLUMN bundle INTEGER NOT NULL DEFAULT 0 CHECK (bundle IN (0, 1));
