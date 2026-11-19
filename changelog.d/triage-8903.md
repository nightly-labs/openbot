### Fixed

- Agents can see the model ids again when you saved a short password or API key in the Vault, such as
  `claude`. Before, the agent got `[redacted]` in place of each model id that contained the saved
  value, so it could not change the model of an agent. The saved value stays hidden everywhere else.
