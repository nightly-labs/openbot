### Fixed

- An update or restart that waits until the agents are idle no longer waits for an agent's messages and routine runs that cannot start because the provider usage limit is reached. These messages and runs stay in the agent's queue and start after the limit resets. Before, the restart waited until the limit reset, sometimes for hours. On a joined server, the server must also be on the new version.
