### Fixed

- A chat no longer stops working after a model refuses it because the chat has too many images, for example a Venice model in OpenCode after a tool returned more than 10 images. OpenBot now starts a new session with the chat history, and the agent continues on your next message. When the model names the image limit, OpenBot tells you that the chat has too many images. Before, each new message failed again with "Invalid request parameters".
