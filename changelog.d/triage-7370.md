### Fixed

- When Grok or another provider cannot start an MCP server, the message no longer tells you to
  use Test connection to find the cause. That test uses OpenBot's own connection, so it can pass
  while the provider fails. The message now says this, and tells you to start a new chat to try
  again. When the server did not answer in time, the message says so.
