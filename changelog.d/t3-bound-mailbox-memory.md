### Changed

- A server with a long message history uses less CPU for each agent message. Sending a message, starting and finishing a turn, reading the queues and opening a conversation no longer read all the saved messages of all agents. With 70,000 messages, these steps are 5 to 30 times faster. A server must be on this version to get the gain.

### Fixed

- Two messages that an agent got in the same millisecond keep their order after OpenBot restarts.
