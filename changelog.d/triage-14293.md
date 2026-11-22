### Fixed

- A Claude agent can end a wake from its background subagents with no message and no notification
  when the work came from a quiet turn, also when a subagent ran its own commands. Before, the agent
  had to post a reply, such as ".", that notified you.
