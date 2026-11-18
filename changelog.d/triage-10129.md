### Fixed

- When the model provider of an OpenCode agent is busy or fails, for example with a 502 or 504
  error, the chat now shows that OpenCode tries again, with the attempt number. Before, the agent
  showed no sign of the retries for about 90 seconds and looked very slow. When OpenCode stops
  trying, the chat now says that the model provider failed on its side, and that you can try again
  later or choose another model. Before, it showed the raw text "RequestError: Internal error:
  Provider request failed with HTTP 504". For an agent on a joined server, the server must also be
  on the new version.
