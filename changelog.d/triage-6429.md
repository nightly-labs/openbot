### Fixed

- A chat no longer stops working after a model refuses an image because it is too large. OpenBot now starts a new session with the chat history, and the agent continues the task on your next message. Before, each new message to that agent failed with "Inline image exceeds maximum dimensions" until you started a new chat.
