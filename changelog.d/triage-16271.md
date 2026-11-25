### Fixed

- In a channel, **Continue** and **Reassign** now start a stopped task immediately after the provider did not confirm the start of a turn, and **Cancel task** frees the agent for its other channel work immediately. Before, the card went away but the task, and the other work of that agent in the channel, waited up to 5 minutes. On a joined server, the server must also be on the new version.
