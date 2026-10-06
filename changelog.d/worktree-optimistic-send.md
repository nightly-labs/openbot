### Changed

- A message you send shows in the chat at once, marked as sending, and the composer stays free for the next one. Before, the composer waited until the server accepted the message. Several messages sent quickly reach the agent in the order you sent them.
- In the web client, a send that fails no longer blocks the composer until you check the conversation. The message stays in the chat with its failure.

### Added

- A message that could not be sent stays in the chat with Retry, Edit and Dismiss. Retry does not send the message two times, also when the first attempt reached the server and only its answer was lost. A server on an older version cannot detect a repeated message, so for it the chat offers only Edit and Dismiss. If you quit or restart before such a message is sent, its text is back in the composer when you return; nothing sends it again on its own.
