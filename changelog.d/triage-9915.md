### Fixed

- A ChatGPT agent no longer fails on each message after ChatGPT refuses its request with only
  `{"detail":"Bad Request"}`, which can occur in a long chat with many images. OpenBot now starts a
  new ChatGPT session with the chat history and sends the message again. Before, each later message
  failed with the same raw error until you started a new chat. A joined server needs this version too.
