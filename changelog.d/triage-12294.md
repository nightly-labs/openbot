### Fixed

- On Windows, the delete of an agent that used Grok or another provider other than OpenCode could fail
  each time with "Retry deleting the agent", and the agent stayed in the list until a restart. The
  provider, or a command that it started, kept the empty agent folder in use. When the folder stays in
  use, the delete now stops that provider if no other work uses it, and removes the folder again, so
  the agent goes. When another agent's work still uses that provider, the app says so.
