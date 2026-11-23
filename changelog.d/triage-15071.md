### Fixed

- A Kiro CLI custom agent on Kiro's default agent engine can change its model again. Before, each turn
  with a model other than "auto" stopped with "Method not found: session/set_config_option". You do
  not need to add `--agent-engine v3` to the command.
