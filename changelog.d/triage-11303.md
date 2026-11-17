### Fixed

- When an agent's turn failed for a WhatsApp, Telegram, Slack or Discord message, the chat always
  showed "OpenBot could not finish this request. The OpenBot host has the details.", and the app did
  not show the cause. The chat now gives the reason when OpenBot knows it, for example "Your Claude
  sign-in expired. Sign in again to continue." or a spent usage limit. The provider's own error text
  still does not go to the chat. For an agent on a joined server, the server must also be on the new
  version.
