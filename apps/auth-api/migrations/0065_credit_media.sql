CREATE TABLE credit_media_models (
  model_id TEXT PRIMARY KEY CHECK (length(model_id) BETWEEN 1 AND 80),
  upstream_id TEXT NOT NULL CHECK (length(upstream_id) BETWEEN 1 AND 200),
  kind TEXT NOT NULL CHECK (kind IN ('image', 'video')),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  maker TEXT NOT NULL CHECK (length(maker) BETWEEN 1 AND 80),
  variant TEXT CHECK (variant IS NULL OR length(variant) BETWEEN 1 AND 40),
  position INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  specs TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(specs)),
  upstream_params TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(upstream_params)),
  updated_at INTEGER NOT NULL
);

CREATE INDEX credit_media_models_enabled ON credit_media_models(enabled, kind, position);

CREATE TABLE credit_media_prices (
  model_id TEXT NOT NULL REFERENCES credit_media_models(model_id) ON DELETE CASCADE ON UPDATE CASCADE,
  resolution TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL CHECK (unit IN ('item', 'second')),
  credits REAL NOT NULL CHECK (credits > 0),
  silent_credits REAL CHECK (silent_credits IS NULL OR (silent_credits > 0 AND silent_credits <= credits)),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (model_id, resolution)
);
