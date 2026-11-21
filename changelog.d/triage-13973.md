### Fixed

- When Kimi refuses a message because its chat changed outside the turn, OpenBot opens the chat
  again and sends the message one more time. Before, the turn or the routine run failed with
  "Session was updated by another client". If the second try also fails, OpenBot asks you to send
  the message again.
