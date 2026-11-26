### Fixed

- When a custom provider refuses the effort of a model with a message such as "reasoning_effort must
  be one of low, high, or max", the chat now tells you to edit the efforts of the model in Server
  settings > Providers. Before, the chat showed only "Internal error" and the text of the provider.
