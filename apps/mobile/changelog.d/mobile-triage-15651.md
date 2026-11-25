### Fixed

- A Pi agent that uses a ChatGPT sign-in model now continues when its chat becomes too long for the model. The server starts a new Pi session with the chat history and sends the message again. Before, the agent stopped responding. The server must be on the new OpenBot version.
