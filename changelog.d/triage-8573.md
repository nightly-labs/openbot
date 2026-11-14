### Fixed

- In a WhatsApp, Slack, Telegram or Discord conversation, an agent asked a teammate and got the
  result. When the agent then ended its turn with no answer, the result did not go back to the
  conversation. The agent now tries once more by itself, as it does in its own chat, and the
  conversation gets the answer. The conversation shows that the request failed only when the second
  try also gives no answer. On a server, the server must also be on this version.
