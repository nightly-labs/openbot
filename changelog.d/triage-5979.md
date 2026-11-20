### Fixed

- A Mistral chat or a custom agent chat stayed blocked: each message failed with "A turn is already
  running" after the agent did not end an earlier turn. OpenBot now starts a new session with the chat
  history at the first such error and sends the message again, so the answer comes without a new chat.
