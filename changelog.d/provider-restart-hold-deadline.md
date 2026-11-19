### Fixed

- When you change a provider setting, choose the installed CLI, or update a provider while one agent
  runs a long turn, the other agents of that provider now start new messages again after 10 minutes.
  The restart or update stays pending and runs when the provider is next idle. Before, every agent of
  the provider waited until the long turn ended, which could take more than an hour.
