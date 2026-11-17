### Changed

- While agents write, the app reads the unread counts from the server at most once a second. Before,
  each streamed piece of text started a new read, and a server with many agents used much CPU on it.
