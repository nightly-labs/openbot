### Fixed

- An agent no longer stops when an edit of its next queued message is not saved or cancelled. Before,
  all routines, webhooks and messages of that agent stayed "queued" until somebody deleted that
  message, also after a restart. Now an edit holds the message for 10 minutes at most, and an edit
  from before a restart does not hold it. After that, the message runs with its original text. On a
  joined server, the server must also be on this version.
