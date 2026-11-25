### Fixed

- When an agent stops before a long request is done, and OpenBot cannot continue it automatically
  again, the chat now says so and tells you to send a message to continue. In its last automatic
  continuation, the agent also ends with what is done, what is left, and what to send next. Before,
  the agent stopped without a word, and you could not know why it stopped. A server must also be on
  this version.
