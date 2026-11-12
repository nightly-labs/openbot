### Fixed

- An agent that answers Discord, Slack, Telegram or WhatsApp no longer stops when it wants your
  approval before it sends a message to another person. Before, it showed a confirm card that
  nobody could open or press, so the turn did not end, and each later message in that chat got "Too
  many requests are waiting. Try again later." Now the agent shows the draft in its answer and asks
  you to confirm it in the chat. On a joined server, the server must also have this version.
