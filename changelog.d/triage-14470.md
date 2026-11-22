### Changed

- When an agent with automatic backup models moves to a backup after a provider error, the chat now
  names the model that stopped and says why and when the agent switches back. For example: "Gemini 4
  Hydrogen reached a short rate limit. Switched to Claude Sonnet 5.5. Switches back in about 10
  minutes." When the account does not offer the model now, the chat says so, with no return time.
  In a narrow chat, such as with a side panel open, the line wraps, so the return time stays visible.
  Before, the chat showed only "Provider error. Switched to …", so it looked like the quota was used
  up, and users switched back by hand. The Backup models settings now also say that a provider error
  can switch the model after the agent starts to write. On a joined server, the server must also be
  on the new version.
