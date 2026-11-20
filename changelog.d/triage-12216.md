### Fixed

- When a Telegram chat is linked but no Telegram Orchestrator answers it, OpenBot now shows you how to add
  it. Before, the bot only said "Add the Telegram Orchestrator in OpenBot", and when you asked an agent,
  it said that Telegram was already connected. Now the bot says to open Marketplace > Apps > Telegram and
  click Add agent, and your agent shows a card that opens that page. This also works for Slack, Discord
  and WhatsApp when their orchestrator is missing. If your agents run on a joined server, the server must
  also be on the new version.
