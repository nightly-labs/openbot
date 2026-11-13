### Fixed

- When a local model could not summarize a long chat for OpenCode, each later message in that chat
  failed with "Compaction summary did not match the required template". Now OpenBot starts a new
  OpenCode session with the chat history and sends the message again. When it cannot send the
  message again, the chat tells you to try again or to select a stronger model.
