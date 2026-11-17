### Fixed

- A channel request no longer stops with "Select an available member of this channel." when the
  lead's model copies a member's id with a wrong character. Before, this happened with some models
  for each new message, and you had to reassign the request yourself. Now the lead's model names
  members by short keys that it copies correctly, and a request that names no available member goes
  to the lead, which answers or asks what you mean. For a channel on a joined server, the server
  must also be on the new version.
