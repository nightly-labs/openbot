### Fixed

- A Claude agent gets the tools of an MCP server that has no sign-in and no key again. Before, Claude
  could keep an old "requires authentication" mark for such a server, while the server test said
  that it was ready, and the agent did not get its tools.
