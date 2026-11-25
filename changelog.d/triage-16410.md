### Fixed

- An OpenCode agent on a model that cannot read a PDF or another file in the chat now starts a new session with the chat history, and the chat shows what to do. Before, an endpoint that refused the file with "Unsupported content part type 'file'" showed this technical text, and each later message in the chat failed the same way. For a custom provider model, the message now says to clear Images or PDF at Accepts.
