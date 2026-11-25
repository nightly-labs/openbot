### Fixed

- Start a new OpenCode session with the chat history when OpenCode Go refuses an earlier effort
  change in the chat (`messages.N.output_config.effort`), for example after a model change. Before,
  each new message in that chat failed with "The model provider failed on its side". A joined or
  hosted server must also be on the new version.
