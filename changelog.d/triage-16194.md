### Fixed

- While a routine runs in an agent's chat and the agent also works on a turn that it started by itself (for example after a background command ends), Steer on a queued message now sends the message into that turn. Before, Steer was on but did nothing and showed no reason, and the message waited until the routine ended. A message for the routine's own turn still waits in the queue, as before. On a joined server, the server must also be on this version.
