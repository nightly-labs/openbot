### Fixed

- A Codex chat continues after the model does not accept audio. Before, when a tool gave audio to a
  model such as GPT-6.2 Sol, the chat stopped with "HTTP 400 Audio input is not available.", and
  each later message in that chat failed the same way. Now OpenBot starts a new Codex session with the
  chat history and tells you to try again.
