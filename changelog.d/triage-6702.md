### Fixed

- A chat no longer stops working after a model refuses it because the chat has too many images, for example a Venice model in OpenCode after a tool returned more than 10 images. OpenBot now starts a new session with the chat history and shows what happened. Before, each new message failed again with "Invalid request parameters".
