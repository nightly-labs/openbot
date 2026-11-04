### Fixed

- Show the models of a custom ACP agent whose model values contain quotes, such as DeepSeek Harness.
  Before, OpenBot dropped all of them, and the agent could not be selected. A custom agent with no
  usable model now gets the Default model, and a model that OpenBot cannot use shows in the log.
