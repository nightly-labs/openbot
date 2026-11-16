### Fixed

- A Gemini agent (Antigravity CLI 1.5 or later) now continues by itself when the subagents that it
  started in the background finish. Their result and the approvals that the agent then asks for show
  in the chat as a new reply. Before, the agent stopped with no message until you sent another
  message, and a background subagent could stop when OpenBot closed the idle Gemini session. On a
  joined server, the server must also be on this version.
