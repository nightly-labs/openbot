### Fixed

- When OpenBot cannot delete a messaging orchestrator (for example the "WhatsApp Orchestrator"), the
  agent now stays the orchestrator of its chats. Before, the agent stayed in the list but WhatsApp,
  Telegram, Slack or Discord no longer used it, and connecting again made a second orchestrator. On
  a server, the server must also be on the new version.
