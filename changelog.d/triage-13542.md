### Fixed

- When OpenBot lost its connection to the OpenBot service, an agent's Telegram post failed with
  "The platform refused the call: telegram_503". The agent then blamed Telegram and checked the wrong
  things. Now the agent is told that OpenBot is not connected to its service and that Telegram is not the
  cause, so it can tell you what to check.
