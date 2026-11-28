### Fixed

- A WhatsApp, Slack, Discord or Telegram message that reaches an agent at its provider usage limit
  now runs on the agent's automatic backup model, or waits until the limit resets, as a message in
  the agent's own chat does. Before, the chat app got "OpenBot could not finish this request" and
  the message was lost.
