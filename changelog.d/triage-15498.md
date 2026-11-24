### Fixed

- An OpenCode agent no longer stays stuck when OpenCode Go refuses each message with "the request is invalid". This occurs in a long chat, for example with GLM 5.3. OpenBot now starts a new OpenCode session with the chat history and sends the message again, so the agent continues in the same chat. On a joined server, the server must also be on the new version.
