### Fixed

- Agents can add a trigger to a table that they created in the shared database, for example to stop
  changes to saved records. Before, each trigger failed with "Send one SQL statement per call". An
  agent cannot add a trigger to a table that a different agent created. On a joined server, the
  server must also be on this version.
