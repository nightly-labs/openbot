### Fixed

- An OpenCode chat no longer stops working after the model refuses a file in the chat, such as a
  PDF that the agent opened. OpenBot now starts a new session with the chat history and tells you
  that a file in the chat can cause this, and to send the message without the file or select a
  different model. Your next message continues in the same chat. Before, each new message in that
  chat failed with "Invalid input", and only a new chat helped.
