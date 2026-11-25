### Fixed

- A Gemini (Antigravity) agent's chat no longer stays busy for up to 30 minutes after the agent
  answers while a command that it started still runs. The answer shows as done, and the chat shows
  "Waiting for background work…" below it. When the command ends, the agent continues by itself.
  Routine runs and channel tasks wait for the command as before. A joined server must also be on
  this version.
