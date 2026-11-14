### Fixed

- An OpenCode chat no longer stops working after a model refuses an image or a file that it cannot
  read, for example a custom provider model that accepts text only. OpenBot now starts a new session
  with the chat history and tells you to send the message again without the file, or to clear
  Images at Accepts for a custom provider model. Before, some endpoints showed only their own error
  text, and each new message failed again until you chose a different model.
