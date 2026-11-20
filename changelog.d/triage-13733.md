### Fixed

- When the connection to Cursor stops during an answer, the chat now says "Cursor lost its
  connection. Send your message again." Before, the answer ended with a technical error such as
  "RetriableError: [canceled] http/2 stream closed". A backup provider can now take a message that
  stopped this way before the agent did any work.
