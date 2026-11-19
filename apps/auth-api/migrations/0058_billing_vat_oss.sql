-- The EU One Stop Shop limit. The seller is in Poland and is not in the OSS, so a consumer in another EU
-- country pays Polish VAT. When these sales pass EUR 10,000 in a calendar year, the seller must charge the
-- VAT of the buyer's country instead. The Worker keeps the net amount of each paid invoice of such a
-- consumer (`billing-oss.ts`) and sends one operator alert for a year at EUR 9,000. The rows hold a Stripe
-- invoice ID, a country and an amount, and no account. Rows older than the previous year are deleted.
-- Only new tables: the Worker from before this deploy does not read them.
CREATE TABLE IF NOT EXISTS billing_vat_oss_sales (
  invoice_id TEXT PRIMARY KEY,
  year INTEGER NOT NULL,
  country TEXT NOT NULL,
  amount_eur INTEGER NOT NULL CHECK (amount_eur >= 0),
  paid_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS billing_vat_oss_sales_year ON billing_vat_oss_sales(year);

CREATE TABLE IF NOT EXISTS billing_vat_oss_alerts (
  year INTEGER PRIMARY KEY,
  total_eur INTEGER NOT NULL,
  alerted_at INTEGER NOT NULL
);
