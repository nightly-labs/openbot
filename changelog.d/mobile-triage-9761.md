### Fixed

- A message to a Hermes agent no longer fails at random with "Internal error: revision_conflict". OpenBot
  now applies the agent's settings again, and when Hermes still refuses, the message stays in the queue and
  starts by itself a short time later. When it cannot start after some tries, the chat tells you in plain
  words to send it again. For an agent on a joined server, the server must also be on the new version.
