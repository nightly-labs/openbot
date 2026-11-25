CREATE TABLE credit_media_routes (
  model_id TEXT NOT NULL REFERENCES credit_media_models(model_id) ON DELETE CASCADE ON UPDATE CASCADE,
  upstream TEXT NOT NULL CHECK (length(upstream) BETWEEN 1 AND 40),
  upstream_id TEXT NOT NULL CHECK (length(upstream_id) BETWEEN 1 AND 200),
  upstream_params TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(upstream_params)),
  upstream_fields TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(upstream_fields)),
  specs TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(specs)),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (model_id, upstream)
);

INSERT INTO credit_media_routes(model_id, upstream, upstream_id, upstream_params, updated_at)
SELECT model_id, upstream, upstream_id, upstream_params, updated_at FROM credit_media_models;

CREATE TABLE credit_media_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  upstream TEXT NOT NULL CHECK (length(upstream) BETWEEN 1 AND 40),
  updated_at INTEGER NOT NULL
);

INSERT INTO credit_media_settings(id, upstream, updated_at) VALUES (1, 'router', unixepoch('now') * 1000);

ALTER TABLE credit_holds ADD COLUMN upstream_fields TEXT;
