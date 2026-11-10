### Fixed

- In a channel, a message that starts with "continue" or "resume" now continues a subtask that stopped
  while the lead waited for it, for example after OpenBot restarted. Before, the message started a new
  request, and the stopped subtask and its lead kept waiting.
