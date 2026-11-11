### Added

- Disconnect the first Gemini account in Settings > Providers. Before, only the accounts after the
  first had an action that removed them. On a joined server, the server must also be on the new
  version.

### Fixed

- Keep the first Gemini account in the usage popover while Gemini is idle. Before, the account went
  from the list about an hour after its last session, and only the accounts after the first stayed.
- Say on the first Gemini account when a saved Gemini API key is used in its place. The key does not
  give Gemini 4 Carbon or the Claude and GPT models of the Google plan. Before, the account kept a
  Reconnect that opened nothing, and the models changed with no reason shown. Remove the key to use
  the account's plan again.
