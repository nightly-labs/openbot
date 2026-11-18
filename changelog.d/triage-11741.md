### Fixed

- Keep an agent's backup models when another agent changes them while a usage limit keeps the agent on
  a backup. Before, the change emptied the list or made the main account its own backup, and at the
  next limit the agent did not switch. On a joined server, the server must also be on this version.
