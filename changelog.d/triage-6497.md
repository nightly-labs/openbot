### Fixed

- Agents can now use an n8n MCP server that you signed in to through OpenBot. Before, the server
  test showed the server as ready, but each agent chat could not connect to it, because n8n blocked
  the name that OpenBot sent with each request. You no longer need to add a `User-Agent` header to
  the server to make it work.
