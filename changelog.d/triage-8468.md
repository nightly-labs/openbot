### Fixed

- A Gemini agent whose earlier session the Gemini CLI can no longer read now starts a new session
  with its chat history and answers. Before, each message in that chat failed with "Failed to read
  session …; retry, or load it with session/load". An agent on a joined server gets the fix when
  the server is also on this version.
