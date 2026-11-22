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
