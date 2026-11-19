ALTER TABLE hosted_servers ADD COLUMN operator_host TEXT
  CHECK (operator_host IS NULL OR provider_sandbox_id IS NULL);
ALTER TABLE hosted_servers ADD COLUMN retired_sandbox_id TEXT;
CREATE UNIQUE INDEX hosted_servers_operator_host ON hosted_servers(operator_host)
  WHERE operator_host IS NOT NULL;
