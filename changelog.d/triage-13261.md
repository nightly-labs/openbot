### Fixed

- An agent with backup models set to Automatic now moves to its next backup model when the provider
  says that a model with a dot in its name, such as `gpt-4.1-mini`, does not exist or is not
  supported. Before, the agent stopped on that model and tried it again with each new message.
