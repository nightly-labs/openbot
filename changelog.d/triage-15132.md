### Fixed

- When a provider update removed the model of an agent, OpenBot moved the agent to the first model of
  that provider, for example a free OpenCode model, and did not tell you. Now the agent moves to its
  first backup model that is ready. When no backup model is ready, it moves to the provider's model as
  before. The chat now says which model is no longer available and which model the agent uses now. On
  a joined server, the server must also run this version.
