### Fixed

- An agent with backup models set to "Automatic" now moves to its next backup model when Google
  says that the account has no valid license for a Gemini model, before the agent starts work.
  Before, the chat showed "Gemini stopped because of an error", and each new message failed on the
  same model. The server must be on the new OpenBot version.
