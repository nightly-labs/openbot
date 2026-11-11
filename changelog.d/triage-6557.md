### Fixed

- A Claude agent now answers the result of a background subagent when the subagent finishes after the
  agent's turn ended. Before, if another thread or another Claude agent finished a turn at the same
  moment, OpenBot could close the agent's session first. The result then stayed unread until you sent
  a new message, and the agent's first reply was "No response requested."
