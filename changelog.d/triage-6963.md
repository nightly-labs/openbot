### Fixed

- A Codex chat no longer sends the agent's memories and teammates again when you write after a pause
  of 10 minutes or more. Before, OpenBot stopped the idle Codex process, and the next message sent
  this unchanged context again, which used more tokens and more of the chat's context.
