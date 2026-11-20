### Fixed

- When an agent stopped because the credit balance of its account was too low, for example a Claude
  account with too few usage credits, the chat showed an empty reply and no reason. Now the chat shows
  that the credit balance is too low and what to do. This also applies when the agent has backup
  models but none of them could take the message. For an agent on a joined server, the server must
  also be on the new version.
