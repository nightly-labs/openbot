### Fixed

- A ChatGPT (Codex) agent no longer stays on "working" without end when Codex stops responding. After
  15 minutes with no output (60 minutes while a command or a tool runs), OpenBot ends the turn, says so
  in the chat, and the agent's queued messages continue. An agent that gave the work to it gets a reply
  that says that the request failed. A wait for your answer does not count. On a joined server, the
  server must also run this version.
