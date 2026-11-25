ALTER TABLE credit_media_models ADD COLUMN upstream TEXT NOT NULL DEFAULT 'router'
  CHECK (length(upstream) BETWEEN 1 AND 40);
ALTER TABLE credit_holds ADD COLUMN upstream TEXT;
ALTER TABLE credit_holds ADD COLUMN upstream_model TEXT;
ALTER TABLE credit_holds ADD COLUMN upstream_params TEXT;
ALTER TABLE credit_holds ADD COLUMN submit_lease_until INTEGER;
