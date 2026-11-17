### Fixed

- A Claude agent that starts a new chat by itself no longer stops its own background subagents and
  commands. Before, the new chat started when the turn ended, the running work stopped, and its result
  was lost with no message. Now the new chat starts after that work finishes and the agent has given
  its result. For an agent on a joined server, the server must also be on the new version.
