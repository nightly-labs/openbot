### Fixed

- A thread that fails on a spent credit balance or quota now shows the provider's reason, for example "Credit balance is too low". Before, it showed "The provider gave no reason".
- An agent that moved to a backup model because a credit balance was spent no longer goes back to that model after a restart or after 10 minutes. Before, its next turn failed again on the same balance.
- A thread turn that fails on a provider error before it does work now moves an agent set to switch automatically to its backup model, as a failed chat turn does.
