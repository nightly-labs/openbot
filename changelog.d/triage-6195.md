### Fixed

- When a chat with a local model does not fit in the model's context window, the chat now tells you
  to load the model with a larger context length in Ollama or LM Studio, or to choose a larger
  model. Before, the first message to an agent could fail with only "The compaction request cannot
  be reduced further without losing the latest exchange or checkpoint" or "Nothing to compact yet".
