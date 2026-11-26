### Added

- Settings > Providers > Pool accounts has a new choice, **Spread**. With Spread, OpenBot puts agents on the accounts with the most usage left, so all accounts get used. An agent changes accounts only when another account has much more room. **Fill first** stays the default. A server must be on this version for the web app and the desktop app to show the choice.

### Fixed

- You can now remove a provider account while an agent turn uses it. OpenBot waits for the turn to end, then moves the agents to other accounts and removes the account. Before, OpenBot refused to remove the account until you stopped its agents.
