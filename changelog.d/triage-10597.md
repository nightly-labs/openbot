### Fixed

- When an agent could not start for a Telegram, WhatsApp, Slack or Discord message because its
  provider is not downloaded or its sign-in expired, the chat showed only "OpenBot could not finish
  this request". The chat now says what is wrong and what to do, for example "ChatGPT is not
  downloaded. Download it in OpenBot to continue." A channel task that stops for a provider that is
  not downloaded now says the same. For an agent on a joined server, the server must also be on the
  new version.
