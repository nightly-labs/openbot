### Added

- Workflows: a schedule, GitHub, Discord, Telegram or Slack trigger now gives fixed fields to the steps after it, such as `{{title}}`, `{{author}}` and `{{labels}}` for a GitHub issue, `{{channel}}` and `{{text}}` for a chat message, and `{{weekday}}` and `{{local_date}}` for a schedule. A check such as `author = ana` can use them with no model step. On a joined server, the server must also be on the new version.
