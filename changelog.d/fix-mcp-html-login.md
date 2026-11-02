### Fixed

- An MCP server that redirects to a web login page asks for an Authorization header with a Bearer token. Before, the test showed a JSON parse error and the agent asked for a browser sign-in.
