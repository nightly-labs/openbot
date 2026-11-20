### Fixed

- With Hermes Agent older than 0.22.1, two Hermes agents could not message each other: OpenBot
  refused the message with "An agent cannot message itself", and the OpenBot tools of one agent
  could run as another agent. Now each chat of an older Hermes runs in its own Hermes process, so
  each agent acts as itself. Hermes 0.22.1 and newer do not change. For an agent on a joined server,
  the server must also be on the new version.
