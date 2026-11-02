### Fixed

- A custom model with an output limit below 32,000 tokens can run a turn on OpenCode again. Before,
  OpenCode asked the endpoint for 32,000 output tokens on every turn, and the endpoint refused the
  request. A model with a context window and no output limit now gets at most 16,384 output tokens,
  as on Pi.

### Added

- A max output field for each custom model, next to the context window. OpenCode and Pi send this
  limit to the endpoint. Leave it blank to use the default.
