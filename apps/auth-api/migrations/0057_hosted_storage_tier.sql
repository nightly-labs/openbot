-- The storage tier that the plan of a hosted server pays for. Only a server on a VPS of the operator
-- (`operator_host`) has tiers: 0 is the plan storage, and 1 and 2 are larger disks that the owner buys
-- as a Stripe add-on. The Worker copies it from the subscription after each sync. The default is the
-- plan storage, so each current row keeps its storage, and the Worker before this deploy, whose inserts
-- name their columns, writes valid rows.
ALTER TABLE hosted_servers ADD COLUMN storage_tier INTEGER NOT NULL DEFAULT 0 CHECK (storage_tier IN (0, 1, 2));
