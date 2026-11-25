### Fixed

- When OpenCode loses the session of a chat while a message starts, OpenBot now starts a new OpenCode session with the chat history and sends the message again one time. Before, the message failed with the technical text "Invalid params: session not found", and you had to send it again. When the agent had already started to answer, the chat now says that OpenBot started a new OpenCode session and that you can try again.
