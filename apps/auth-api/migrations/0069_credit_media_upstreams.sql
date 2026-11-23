ALTER TABLE credit_media_models ADD COLUMN upstream TEXT NOT NULL DEFAULT 'router'
  CHECK (length(upstream) BETWEEN 1 AND 40);
ALTER TABLE credit_holds ADD COLUMN upstream TEXT;
