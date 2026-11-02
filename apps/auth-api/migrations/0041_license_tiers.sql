-- New columns with defaults only. The Worker that runs before this deploy names its columns in each
-- INSERT and SELECT, so it keeps working.
--
-- A hosted server made before this migration keeps the member limit of its plan at that time: Starter 3,
-- Standard 10, Pro 25. A server that the old Worker makes during the deploy also gets 1 here, so it keeps
-- them too. The new Worker writes 0 for each new server, which gets the limits of `BILLING_PLANS`.
ALTER TABLE hosted_servers ADD COLUMN legacy_member_limits INTEGER NOT NULL DEFAULT 1
  CHECK (legacy_member_limits IN (0, 1));

-- The tier, interval and bundle price of the license Price. NULL is a row that the old Worker wrote: Team,
-- monthly. The old Worker does not name `bundle`, so its rows get 0, the plain price.
ALTER TABLE licenses ADD COLUMN tier TEXT CHECK (tier IS NULL OR tier IN ('starter', 'team'));
ALTER TABLE licenses ADD COLUMN billing_interval TEXT
  CHECK (billing_interval IS NULL OR billing_interval IN ('month', 'year'));
ALTER TABLE licenses ADD COLUMN bundle INTEGER NOT NULL DEFAULT 0 CHECK (bundle IN (0, 1));
