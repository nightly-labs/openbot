### Fixed

- An agent with backup models set to "Automatic" now moves to its next backup model when Google
  says that the account has no valid license for a Gemini model ("You do not have a valid license of
  this product"), before the agent starts work. Before, the agent stayed on that model, and each new
  message failed with "Gemini stopped because of an error". Without a backup model, the error now
  tells you to choose another model. On a joined server, the server must also be on the new version.
