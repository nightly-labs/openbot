### Fixed

- A chat no longer stops working when a model behind OpenCode refuses it with "This request has
  more images than the limit of …". OpenBot now starts a new session with the chat history, as it
  does for other image limits, and tells you that the chat has too many images. Before, each new
  message failed again with the same error.
