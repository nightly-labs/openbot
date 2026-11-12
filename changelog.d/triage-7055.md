### Fixed

- An agent that reads older messages of a chat by a message ID now gets them. Before, it got
  "History is unavailable for this request", and a routine that reviews earlier work could skip
  messages. When the message is not in that chat, the agent now gets an error that tells it what to
  send instead.
