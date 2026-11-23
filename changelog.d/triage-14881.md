### Fixed

- Tell the user to load a local model with a larger context length when an OpenCode agent on a
  custom model with a window under 64,000 tokens cannot compact its chat. Before, the chat said
  that the chat was too long and to select a stronger model, also in a new chat.
