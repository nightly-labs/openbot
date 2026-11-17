### Fixed

- Keep the password card and the card that asks you to add an item to the Vault open with a Cursor
  agent until you finish them. Before, they closed after about one minute with the error "MCP error
  -32001: Request timed out", and the sign-in or sign-up stopped. When you save the Vault item after
  the agent stopped waiting, the agent gets the name of the saved item in a new message.
