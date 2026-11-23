CREATE INDEX credit_ledger_user_created ON credit_ledger(user_id, created_at) WHERE user_id IS NOT NULL;
CREATE INDEX credit_ledger_server_created ON credit_ledger(server_id, created_at) WHERE server_id IS NOT NULL;
CREATE INDEX credit_holds_user_created ON credit_holds(user_id, created_at) WHERE user_id IS NOT NULL;
CREATE INDEX credit_holds_server_created ON credit_holds(server_id, created_at) WHERE server_id IS NOT NULL;
