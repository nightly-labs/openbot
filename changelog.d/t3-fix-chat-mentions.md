### Changed

- Ping a Telegram or WhatsApp user that an agent's answer or post mentions: `@username` or
  `@<user ID>` in Telegram, `@<user ID>` (the phone number) in WhatsApp. Before, Telegram showed the
  mention as text, and WhatsApp sent no notification. An answer with a mention is a new message,
  because an edit of "Working on it…" pings nobody.
