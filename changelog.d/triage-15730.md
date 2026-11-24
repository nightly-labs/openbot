### Fixed

- A message from another agent or a routine no longer stops a busy Claude agent's work. Before, it stopped the running step and the subagents of that turn, and the chat showed "Request interrupted by user". Now the agent reads the message when its running step ends. Your own messages still reach a busy Claude agent at once. On a joined server, the server must also be on this version.
