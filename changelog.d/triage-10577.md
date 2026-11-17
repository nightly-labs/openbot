### Fixed

- Keep the password card and the Vault card open with a Cursor agent until you finish them. Before,
  they closed after about one minute with the error "MCP error -32001: Request timed out", and the
  sign-in or sign-up stopped. A Vault card that you save after the agent stopped waiting tells the
  agent the name of the saved item in a new message.
