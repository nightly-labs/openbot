### Fixed

- When a saved Gemini API key reaches its rate limit or quota, the chat now says that the key, not
  your Google plan, reached it, and that removing the key in Settings brings back your Google plan.
  When the key has no quota for the model, the message no longer tells you to wait. Before, the
  message named the plan's quota. On a joined server, the server must also be on the new version.
