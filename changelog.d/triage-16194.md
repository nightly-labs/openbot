### Fixed

- While a routine runs in an agent's chat and the agent also works on a turn that it started by itself (for example after a background command ends), your message now goes into that turn: when you click Steer on a queued message, and when you send a message while messages steer the running turn. Before, Steer was on but did nothing and showed no reason, and the message waited until the routine ended. A message for the routine's own turn still waits in the queue, as before. On a joined server, the server must also be on this version.
