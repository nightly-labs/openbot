### Fixed

- Stop now ends a Gemini agent's turn that shows "working" while Gemini no longer runs it. Before, Stop did
  nothing in this state: the agent stayed "working", and its new messages stayed in the queue until OpenBot
  restarted. Now the turn ends as stopped, and the queued messages start. This also applies to other agents
  that use the same connection, such as Cursor, Grok and OpenCode. When the agent runs on a joined server, the
  server must also be on this version.
