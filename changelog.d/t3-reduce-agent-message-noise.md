### Changed

- An agent no longer sends a notification or plays the task sound when it finishes a turn that
  another agent's message started. Before, one delegated job gave a notification from each agent
  that worked on it, often with the same result. The answers stay in the chats and count as unread.
  A question, an approval request and a failed turn still notify. For phone notifications, the
  server must also be on the new version.
