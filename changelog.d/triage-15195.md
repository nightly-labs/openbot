### Fixed

- When a local model server refuses a chat that does not fit its context window and says that the prompt leaves no room for generation, OpenBot now tells you to make the context window in OpenBot the same as on the server, or to load a larger one. Before, the chat showed only "Internal error" and the server's technical text.
