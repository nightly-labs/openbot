ALTER TABLE referral_credits ADD COLUMN source_invoice_id TEXT;
ALTER TABLE referral_credits ADD COLUMN ready_at INTEGER;
ALTER TABLE referral_reversals ADD COLUMN source_amount INTEGER CHECK (source_amount IS NULL OR source_amount >= 0);

CREATE INDEX IF NOT EXISTS referral_credits_source_invoice ON referral_credits(source_invoice_id)
  WHERE source_invoice_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS referral_credits_due ON referral_credits(ready_at)
  WHERE released_at IS NULL AND ready_at IS NOT NULL AND balance_transaction_id IS NULL;
CREATE INDEX IF NOT EXISTS referral_credits_queued ON referral_credits(referrer_user_id)
  WHERE queued_at IS NOT NULL AND balance_transaction_id IS NULL;
