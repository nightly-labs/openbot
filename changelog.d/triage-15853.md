### Fixed

- A Gemini agent that waits for replies from its teammates no longer says that the server restarted,
  and no longer gives its teammates the same tasks again. OpenBot stops an idle Gemini process to
  save memory, and Antigravity then told the agent that all its subagents and background tasks
  stopped because of a server restart, also when nothing ran. Now OpenBot tells the agent that no
  server restarted and that its teammates still work. On a joined server, the server must also be on
  this version.
