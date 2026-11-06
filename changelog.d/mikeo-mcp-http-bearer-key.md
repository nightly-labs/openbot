### Fixed

- An MCP server on a plain `http://` network address that asks for a bearer token, and has no OAuth
  sign-in, now saves and asks for a key in Server settings. Before, OpenBot did not save it and asked
  for an `https://` address, which such a server often does not have.
