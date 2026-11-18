### Fixed

- A chat no longer stops working when a model behind a local router refuses it because the chat has
  too many images, for example with "a request may carry at most 8 images". OpenBot now starts a new
  session with the chat history, and the agent continues on your next message. Before, each new
  message failed with the same error until you started a new chat.
