### Fixed

- When a Claude account cannot use the agent's model (Claude says "There's an issue with the selected model … you may not have access to it"), the agent now tries the same model on the other accounts of the pool. When no other account is ready, it moves to its next backup model. Before, each message failed with this error until you changed the account or the model by hand. Agents with no other pool account and no backup model still show the error. For an agent on a joined server, the server must also be on the new version.
