### Fixed

- A stop word such as `cancel` or `stop`, or the Stop button, now stops a Slack, Discord, Telegram or
  WhatsApp request that is still starting. Before, the request ran to the end and posted its answer,
  and the stop word started a new request.
