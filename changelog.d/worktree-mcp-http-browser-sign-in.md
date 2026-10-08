### Added

- Sign in to a custom Streamable HTTP MCP server in your browser, for servers such as Granola that
  use OAuth. Choose Sign in on the server's row or in its form. The panel shows that it waits for the
  browser, lets you cancel, and marks the row Signed in. Sign out deletes the stored sign-in.

### Changed

- Test connection no longer opens a browser. It uses the sign-in that this computer already has, and
  a server that asks for a sign-in shows a Sign in button.
- A failed test now says what kind of failure it was: a sign-in is needed, the server refused, the
  URL is wrong, the server did not answer, it did not start, or it could not be reached.

### Fixed

- A custom MCP server that asks for an OAuth sign-in no longer shows "The server answered 401. Check
  the API key or other credentials." It now asks you to sign in. An `http://` address for such a
  server tells you the `https://` address to use, and a test from another computer tells you to sign
  in on the host.
- A STDIO server that stops before it answers now says so, instead of a timeout. A command that runs
  the `mcp-remote` bridge points you to Streamable HTTP with the same URL.
