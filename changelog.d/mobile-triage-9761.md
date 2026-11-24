### Fixed

- A message to a Hermes agent no longer fails at random with "Internal error: revision_conflict". OpenBot
  now tries the agent's model and effort settings again, and if Hermes still refuses, the message waits in
  the queue and starts a moment later. Before, the message was lost and you had to send it again. For an
  agent on a joined server, the server must also be on the new version.
