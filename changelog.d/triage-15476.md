### Fixed

- When an agent sends work to a channel from a side thread, the channel result now comes back to that side thread, not to the agent's main chat. The main chat no longer starts a second copy of the same work. When the side thread is archived or deleted, the result goes to the main chat as before. The server must also be on the new version.
