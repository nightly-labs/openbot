### Added

- Connect 1Password in the Marketplace or in Server settings > Connectors. The page shows three
  steps: **Install** puts the 1Password CLI in place for you, with no administrator password; then
  turn on the CLI integration in the 1Password app, which the page sees when you come back; then
  **Connect 1Password** creates a "Shared with OpenBot" vault and a service account that can read only
  that vault. You can paste a service account token instead. Agents then sign in to sites in the
  OpenBot browser with the logins you move into that vault. The browser fills the password or
  authenticator code; agents never see it.
