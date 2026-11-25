### Fixed

- Grok: a background problem of the Grok CLI, such as "Settings fetch failed", no longer shows a red Grok error
  notification or marks Grok as failed while Grok still works. OpenBot writes these lines to the provider log.
  Sign-in, usage limit, MCP server and stopped-process errors still show as before. On a joined server, the
  server must also be on the new version.
