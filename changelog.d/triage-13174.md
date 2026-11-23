### Fixed

- In Marketplace > Apps, the MCP server form no longer saves a header name that has a space or a
  symbol, such as `Authorization Bearer`. The form now marks the header key and tells you to put the
  key or token in Value. Before, the server was saved and its test showed a technical error. A
  server that already has such a header shows the same message the next time that you edit or test
  it. Agents that add an MCP server also get this message. On a joined server, the server must also
  be on the new version to refuse the name when a mobile app or an older app saves it.
