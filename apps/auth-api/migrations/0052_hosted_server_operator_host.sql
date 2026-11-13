-- A hosted server that an operator moved from boat to a machine that the operator runs, such as a
-- Leaseweb VPS. `operator_host` names the machine (`leaseweb:<VPS ID>`); NULL = boat runs the server.
-- One machine has one server, so the column is also the record of the machines in use. Such a row has
-- no boat sandbox: the Worker sends no boat call for it and writes only `desired_state`. The operator
-- starts and stops the machine and writes `observed_state`. `retired_sandbox_id` keeps the boat sandbox
-- from before the move, for a move back and for its deletion. The Worker that runs before this deploy
-- does not read or write the columns, so an operator sets them only after the deploy.
ALTER TABLE hosted_servers ADD COLUMN operator_host TEXT
  CHECK (operator_host IS NULL OR provider_sandbox_id IS NULL);
ALTER TABLE hosted_servers ADD COLUMN retired_sandbox_id TEXT;
CREATE UNIQUE INDEX hosted_servers_operator_host ON hosted_servers(operator_host)
  WHERE operator_host IS NOT NULL;
