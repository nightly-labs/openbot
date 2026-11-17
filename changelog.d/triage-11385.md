### Fixed

- When a local model server, such as Ollama, runs out of memory for a long chat, the chat now says
  so and tells you to start a new chat or to load the model with a smaller context length. Before,
  the chat said that the model provider was busy and tried the same request again, and then told
  you to try again later. On a joined server, the server must also be on this version.
