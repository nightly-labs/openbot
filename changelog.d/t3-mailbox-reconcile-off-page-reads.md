### Changed

- A server with many agents uses less CPU when a person opens or scrolls a conversation. OpenBot no longer reads the same messages from the database again when the saved messages already match the mailbox, and it finds the queue of each agent from the index of that agent. A server must be on this version to get the gain.
