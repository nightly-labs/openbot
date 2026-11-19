### Fixed

- Agents can see the model ids again when you saved a short password or API key in the Vault, such as
  `claude`. Before, the agent got `[redacted]` in place of each model id that contained the saved
  value, so it could not change the model of an agent. Only the ids of the models that your providers
  list stay readable. Other text that contains the saved value is still hidden.
