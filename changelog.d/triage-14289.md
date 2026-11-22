### Fixed

- `openbot-cli` and the Local scripts API now return the real agent ID when a short password or key that you saved in the Vault is part of that ID. Before, the agent list showed `[redacted]` in place of the ID, and `openbot-cli` said that no agent with that ID had Local scripts on. Secrets in the text of approvals and questions stay hidden.
