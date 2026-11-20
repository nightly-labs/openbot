### Fixed

- A Mistral chat stayed blocked: each message failed with "A turn is already running" after Mistral
  Vibe did not end an earlier turn. This also occurred with Mistral Vibe added as a custom agent.
  OpenBot now starts a new session with the chat history at the first such error and sends the
  message again, so the answer comes without a new chat.
