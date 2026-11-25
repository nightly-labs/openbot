CREATE TABLE credit_audit (
  audit_id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  event TEXT NOT NULL CHECK (length(event) BETWEEN 1 AND 40),
  result TEXT NOT NULL CHECK (result IN ('ok', 'failed')),
  code TEXT CHECK (code IS NULL OR length(code) BETWEEN 1 AND 60),
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  server_id TEXT,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  credits_tenths INTEGER,
  model_id TEXT,
  reference TEXT,
  detail TEXT CHECK (detail IS NULL OR (json_valid(detail) AND length(detail) <= 1000))
);

CREATE INDEX credit_audit_time ON credit_audit(created_at);
CREATE INDEX credit_audit_user ON credit_audit(user_id, created_at) WHERE user_id IS NOT NULL;
CREATE INDEX credit_audit_actor ON credit_audit(actor_user_id, created_at) WHERE actor_user_id IS NOT NULL;
CREATE INDEX credit_audit_server ON credit_audit(server_id, created_at) WHERE server_id IS NOT NULL;
CREATE INDEX credit_audit_reference ON credit_audit(reference) WHERE reference IS NOT NULL;
CREATE INDEX credit_audit_failed ON credit_audit(created_at) WHERE result = 'failed';

CREATE TRIGGER credit_audit_ledger
AFTER INSERT ON credit_ledger
WHEN NEW.kind <> 'spend'
BEGIN
  INSERT INTO credit_audit(
    audit_id, created_at, event, result, user_id, server_id, actor_user_id, credits_tenths, reference
  )
  VALUES (
    lower(hex(randomblob(16))), NEW.created_at, NEW.kind, 'ok', NEW.user_id, NEW.server_id, NEW.actor_user_id,
    NEW.amount_tenths, NEW.reference
  );
END;

CREATE TRIGGER credit_audit_hold
AFTER INSERT ON credit_holds
BEGIN
  INSERT INTO credit_audit(
    audit_id, created_at, event, result, user_id, server_id, actor_user_id, credits_tenths, model_id, reference
  )
  VALUES (
    lower(hex(randomblob(16))), NEW.created_at, 'hold', 'ok', NEW.user_id, NEW.server_id, NEW.actor_user_id,
    NEW.credits_tenths, NEW.model_id, NEW.job_id
  );
END;

CREATE TRIGGER credit_audit_hold_started
AFTER UPDATE OF provider_job_id ON credit_holds
WHEN OLD.provider_job_id IS NULL AND NEW.provider_job_id IS NOT NULL AND NEW.status = 'held'
BEGIN
  INSERT INTO credit_audit(
    audit_id, created_at, event, result, user_id, server_id, actor_user_id, credits_tenths, model_id, reference
  )
  VALUES (
    lower(hex(randomblob(16))), CAST(strftime('%s', 'now') AS INTEGER) * 1000, 'started', 'ok', NEW.user_id,
    NEW.server_id, NEW.actor_user_id, NEW.credits_tenths, NEW.model_id, NEW.job_id
  );
END;

CREATE TRIGGER credit_audit_hold_settled
AFTER UPDATE OF status ON credit_holds
WHEN OLD.status = 'held' AND NEW.status <> 'held'
BEGIN
  INSERT INTO credit_audit(
    audit_id, created_at, event, result, code, user_id, server_id, actor_user_id, credits_tenths, model_id,
    reference
  )
  VALUES (
    lower(hex(randomblob(16))), COALESCE(NEW.settled_at, CAST(strftime('%s', 'now') AS INTEGER) * 1000),
    NEW.status, CASE WHEN NEW.outcome = 'completed' THEN 'ok' ELSE 'failed' END, NEW.outcome, NEW.user_id,
    NEW.server_id, NEW.actor_user_id, COALESCE(NEW.charged_tenths, NEW.credits_tenths), NEW.model_id, NEW.job_id
  );
END;

CREATE TRIGGER credit_audit_checkout
AFTER INSERT ON credit_purchases
WHEN NEW.status = 'open'
BEGIN
  INSERT INTO credit_audit(
    audit_id, created_at, event, result, user_id, server_id, actor_user_id, credits_tenths, reference, detail
  )
  VALUES (
    lower(hex(randomblob(16))), NEW.created_at, 'checkout', 'ok',
    CASE WHEN NEW.server_id IS NULL THEN NEW.user_id END, NEW.server_id, NEW.user_id, NEW.credits * 10,
    NEW.checkout_session_id, json_object('currency', NEW.currency)
  );
END;

CREATE TRIGGER credit_audit_checkout_expired
AFTER UPDATE OF status ON credit_purchases
WHEN OLD.status = 'open' AND NEW.status = 'expired'
BEGIN
  INSERT INTO credit_audit(
    audit_id, created_at, event, result, code, user_id, server_id, actor_user_id, credits_tenths, reference
  )
  VALUES (
    lower(hex(randomblob(16))), NEW.updated_at, 'checkout', 'failed', 'expired',
    CASE WHEN NEW.server_id IS NULL THEN NEW.user_id END, NEW.server_id, NEW.user_id, NEW.credits * 10,
    NEW.checkout_session_id
  );
END;
