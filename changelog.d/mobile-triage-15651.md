### Fixed

- A Pi agent that uses a ChatGPT sign-in model now continues when its chat becomes too long for the model. OpenBot starts a new Pi session with the chat history and sends the message again. Before, the model refused each new message and the agent stopped responding. The server must also be on the new version.
