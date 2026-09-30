### Fixed

- Sending a message, or a change to a queued message, no longer writes all message history to the
  database again. Before, each change wrote every message and delivery, so on a server that ran for
  weeks each change became slower and used more disk.
