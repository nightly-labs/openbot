### Fixed

- A message that you send to a working Gemini (Antigravity) agent now waits in the queue when the agent
  is about to ask for your approval, and the agent continues its work. Before, the agent's turn failed
  with an internal error, and the agent never read your message. On a joined server, the server must
  also be on this version.
