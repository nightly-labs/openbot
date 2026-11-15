### Fixed

- When the credit balance of an Anthropic API key runs out after a Claude agent starts work on a
  message, the agent now continues that work on its first ready backup model, as it does for a spent
  quota. Before, the message failed with "Credit balance is too low" and the agent stayed on the
  spent key. This also applies when the agent is set to ask before it switches. For an agent on a
  joined server, the server must also be on the new version.
