### Fixed

- A long chat keeps all its messages when streamed text arrives for a message that is not in the newest
  100 messages. Before, OpenBot could keep only the newest 100 messages of that chat, and saving them
  could stop the app for seconds in a very long chat.
- A reply that streams in a chat with more than 100 messages keeps its place in the chat. Before, its
  stored position could move near the start of the chat.
- The first new message in a very long chat is saved faster after OpenBot starts. A new database index
  finds the last message of a chat without a read of all its messages. Older OpenBot releases cannot
  open the database after this update.
