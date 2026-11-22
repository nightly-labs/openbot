### Fixed

- When an agent reaches a usage limit and each of its automatic backup models is also at its limit,
  or failed a short time ago, the chat now says so. It also says that models of one account can
  share one limit, and that a backup model from another provider or another account lets the agent
  continue. Before, the chat showed only the provider's limit text, so it looked as if the backup
  did not start, and a switch to another model on the same Antigravity account failed again. On a
  joined server, the server must also be on this version.
