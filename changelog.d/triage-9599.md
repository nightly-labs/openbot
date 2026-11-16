### Fixed

- A ChatGPT agent no longer stops working when its chat becomes too large to send, for example after it made or read many images. Before, each new message failed again with "request body exceeds 67108864 bytes". OpenBot now starts a new session with the chat history, sends the message again, and tells you in plain words what happened.
