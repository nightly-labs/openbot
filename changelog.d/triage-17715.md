### Fixed

- An OpenCode agent no longer works without end when a file or tool result is too large for the model's context window. Before, the agent read the file, OpenCode shortened the chat, the agent read the file again, and the reply never finished. Now OpenBot stops the turn after three such cycles and tells you to ask for a smaller part of the file or to choose a model with a larger context window.
