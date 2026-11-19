CREATE TABLE IF NOT EXISTS account_attribution (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  acquisition_source TEXT NOT NULL CHECK(acquisition_source IN ('direct', 'search', 'social', 'github', 'other')),
  source_platform TEXT NOT NULL,
  landing_page TEXT NOT NULL,
  first_visit_on TEXT NOT NULL,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  utm_term TEXT,
  recorded_via TEXT NOT NULL CHECK(recorded_via IN ('sign_in', 'checkout')),
  created_at INTEGER NOT NULL
);
