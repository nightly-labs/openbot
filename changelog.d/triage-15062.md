### Fixed

- Keep a message that reaches an OpenCode or custom ACP agent while its turn ends. Before, OpenBot
  steered the message into the ending turn, and the agent did not read it: another agent got a
  "blocked" note and had to send it again, or the message was lost without a note. The message now
  waits in the queue and goes to the agent in its next turn.
