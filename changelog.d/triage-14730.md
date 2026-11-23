### Fixed

- A Claude agent that waits for long background work stays quiet when the work has nothing new. Before,
  Claude Code told the agent after some quiet turns to say what it was doing, and each of these status
  lines showed in the chat with an unread count and a notification.
