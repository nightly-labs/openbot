### Fixed

- An MCP server whose sign-in OpenBot can no longer renew now asks you to sign in again. Before, the
  server stayed "signed in" and the chat showed no Sign in card, but each tool call failed and said
  that the sign-in had ended. When a renewal fails only for a short time, for example on a network
  error, OpenBot keeps the sign-in and the agent reads that the next request tries again. For a joined
  server, the server must also be on the new version.
