### Fixed

- When an agent showed "The agent could not continue. Try again.", the reason was not saved anywhere, so it could not be found later. The provider log (`logs/providers/providers.log`) now keeps the reason, the provider, the model and the turn of each agent error, with secrets removed.
