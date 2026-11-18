### Fixed

- A channel lead with automatic backup models now moves to its next backup model when its model refuses
  the routing of a message because of a spent quota, a rate limit or another provider error. Before, the
  channel showed "The channel lead could not route this message" and the lead stayed on the same model.
  On a joined server, the server must also be on this version.
