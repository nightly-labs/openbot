### Fixed

- The model picker shows each model that you saved on a custom endpoint in the main list. Before,
  some saved models were hidden under "Older models", for example on an LM Studio endpoint or on a
  gateway that serves Claude models.
- A custom endpoint shows only the models that you saved on it. Before, OpenCode added more
  models by itself: catalog models that your server does not have, for example on an LM Studio
  endpoint, and other installed models of a local Ollama or LM Studio server. A model that an agent
  already uses stays available, so no agent changes its model. A joined server gets this fix when
  the server is on the new version.
