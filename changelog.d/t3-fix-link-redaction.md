### Fixed

- Agent answers in Telegram, WhatsApp, Slack and Discord no longer show `[redacted]` in place of
  email addresses, site names or other normal words. Before, a saved password or key that was also
  part of a word, such as the name of your company, hid that word. A chat post now hides text in a
  known key format, such as an API key, a private key or a token, and a saved secret only when it
  stands alone. A joined server sends the chat posts of its agents, so the server must also be on
  this version.
