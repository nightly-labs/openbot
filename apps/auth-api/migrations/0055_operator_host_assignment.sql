-- Two nullable columns. The Worker before this deploy reads neither, and its pool snapshot and the
-- pool script of the operator name their columns.
--
-- A prepared free machine of the pool asks the account service for a server, with a token that only
-- the machine has. A new paid server then starts on that machine and not in a boat sandbox.
--
-- assign_token_hash: the SHA-256 of that token. NULL: the machine gets no new server by itself.
-- seen_at: when the machine last asked. A machine that stopped asking gets no server.
ALTER TABLE operator_hosts ADD COLUMN assign_token_hash TEXT;
ALTER TABLE operator_hosts ADD COLUMN seen_at INTEGER;
