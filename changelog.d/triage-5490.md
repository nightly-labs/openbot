### Fixed

- A Proton Pass login with no password, for example one with only a passkey, now gives "has no
  password for this site" when an agent uses it to sign in. Before, OpenBot reported that the password
  manager could not be read, and signed in to Proton Pass again.
