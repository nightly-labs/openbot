### Fixed

- A skill with Python scripts updates again after its scripts run. Before, the Python cache files
  made the skill show "Modified", and the update stopped with "This skill has local changes". A
  saved skill revision also leaves these cache files out now. On a joined server, the server must
  also be on the new version.
