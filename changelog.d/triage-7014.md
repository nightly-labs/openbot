### Fixed

- When Claude cannot read its sign-in, for example while the macOS login keychain is locked, an
  agent that switches to backup models without asking now moves to its next ready backup model.
  An agent with no backup model now shows "Your Claude sign-in expired. Sign in again to continue."
  Before, each Claude turn failed with "Not logged in · Please run /login", and no backup model
  was tried. On a joined server, the server must also be on the new version.
