### Fixed

- A reply that stopped or failed before the agent wrote any text now says so in the chat and in side
  threads, and tells you to send a message to continue. Before, the chat showed an empty agent reply
  with no reason, and side threads showed nothing. When an agent reads its past chats, it now also
  sees that such a reply stopped or failed, not only an empty message. On a joined server, the server
  must also be on this version for the agent to see this.
