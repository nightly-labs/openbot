### Fixed

- An OpenCode chat now compacts its context automatically at 80%, and the context meter has
  "Compact now". Before, the meter showed "This agent does not compact its context.", and a long
  chat sent an almost full context with each message. This used more tokens than necessary. On a
  joined server, the server must also be on the new version.
