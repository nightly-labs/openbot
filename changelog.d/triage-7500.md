### Fixed

- A custom provider model on OpenCode can now take no reasoning effort: under **Efforts**, clear all
  efforts to select **No reasoning**. Before, OpenBot sent an effort with each message, and a model
  that refuses it, such as Grok 4.20 on xAI, failed every message with "Internal error: Model
  grok-4.20 does not support parameter reasoningEffort". When an endpoint refuses the effort, the
  chat now names the endpoint and the setting to change.
