### Fixed

- An agent that reads its earlier replies again gets the full text. Before, a long reply with code
  or many links stopped after a few lines with `[redacted-unscanned]`, and the agent could send you
  code that did not compile. Saved passwords and keys stay hidden. On a joined server, the agent
  runs on the server, so the server must also be on this version.
