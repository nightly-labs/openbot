### Fixed

- A Codex agent no longer fails on each message after Codex says that an item in its saved history
  is missing ("Items are not persisted when store is set to false"). OpenBot now starts a new Codex
  session with the chat history and sends the message again. Before, each later message failed with
  the same error until you started a new chat.
