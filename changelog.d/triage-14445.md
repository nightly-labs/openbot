### Fixed

- A chat continues when the model provider does not accept the reasoning from an earlier turn, for example when OpenRouter sends a turn to a different model. OpenBot now starts a new session with the chat history and tells you to try again. Before, the chat showed a technical error such as "The encrypted content for item … could not be verified", and the next messages could fail in the same way.
