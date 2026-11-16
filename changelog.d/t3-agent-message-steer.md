### Changed

- A request from another agent goes into the running turn of an agent whose While working setting
  is Steer, as a message from you does. Before, it waited in the queue until the turn ended. The
  agent still sends its result back to the agent that asked. On a server, the server must also be on
  this version.

### Fixed

- A Claude agent, mostly on Claude Haiku, no longer ignores a message from another agent that goes
  into its running turn.
