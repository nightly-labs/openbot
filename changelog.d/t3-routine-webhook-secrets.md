### Added

- An agent can now get the signing secret of its webhook routine, so you do not have to copy it.
  Select **Give the signing secret to <agent>** next to the regenerate button, in the routine
  settings or on the routine card in the chat. The agent gets a new secret as its own API key and can
  add it to the sender. The old secret stops working. When you regenerate the secret or use the
  sender's secret later, the agent gets the new one too. A channel routine does not have this
  button. On a joined server, the server must also be on this version.
