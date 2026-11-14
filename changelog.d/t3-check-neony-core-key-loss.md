### Fixed

- Scripts and routines that read an API key for one agent at its old path,
  `agent-api-keys/<agent>/<NAME>`, work again after an update from 0.69 or earlier. Before, 0.70.0
  moved these keys into the Vault and deleted the files, so these scripts stopped with a missing key.
  The path now links to the agent's copy of the Vault key, and comes back at the next start for
  agents that are already on 0.70.0. A server must also be on the new version.
