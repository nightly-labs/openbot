### Fixed

- A custom provider on LM Studio, or on an app built on it such as Bionic, now gets the context
  window of each model when OpenBot looks up its models. Before, the models had no context window,
  so the agent sent requests with low default token limits.
- Agents can call `openbot.read_video` and `openbot.read_image` directly. Before, on OpenCode, a local
  model such as gpt-oss-20b called them directly, OpenCode refused the call, and the agent searched
  for the tools again until OpenBot stopped the turn.
