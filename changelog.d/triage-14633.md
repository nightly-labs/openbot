### Fixed

- When a chat with a local model on Pi does not fit in the model's context window, the chat now tells
  you to load the model with a larger context length in Ollama or LM Studio, and to enter the same
  window in its OpenBot provider settings. Before, the chat showed only the model server's error,
  such as "the prompt is longer than the context length", and then "Nothing to compact (session too
  small)". On a joined server, the server must also be on the new version.
