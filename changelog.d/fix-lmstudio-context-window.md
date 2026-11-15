### Fixed

- A custom provider on LM Studio, or on an app built on it such as Bionic, now gets the context
  window of each model when OpenBot looks up its models. Before, the models had no context window,
  so the agent sent requests with low default token limits.
