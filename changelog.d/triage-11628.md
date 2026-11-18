### Fixed

- A chat no longer stops working when an Azure model refuses it because the chat has too many images,
  with "Exceeded maximum number of images (50) allowed in the request". OpenBot now starts a new
  session with the chat history, and the agent continues on your next message. Before, each new
  message failed with the same error until you started a new chat.
