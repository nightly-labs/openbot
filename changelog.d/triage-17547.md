### Fixed

- When an agent reads a connected WhatsApp, Telegram, Slack or Discord chat, it now gets long messages in full, up to 16,000 characters. Before, it got only the first 2,000 characters, so a summary of the chat could miss text. A longer message keeps its start and its end, with a note that says how much text is left out.
- When older messages of a chat do not fit in one read, the agent now gets a note that tells it where to continue. Before, some messages sent in the same second as the oldest message shown were lost, and no later read showed them.
