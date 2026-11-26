### Fixed

- Keep a server with a large chat history fast after the upgrade to 0.79.0. Before, the cleanup of old
  chat events read the whole chat activity table once for each event that it deleted, so the server
  stopped for 10 to 17 seconds many times each minute and agents and chats were slow to respond.
