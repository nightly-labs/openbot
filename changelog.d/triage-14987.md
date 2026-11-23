### Fixed

- When a Claude agent goes back to a model that is at its own limit, the agent now moves to its next backup model. Before, Claude Code refused the model change with "API error: 429 … · model not changed", and each new message failed with this error until you selected another model by hand. Agents with no backup model still show the error. For an agent on a joined server, the server must also be on the new version.
