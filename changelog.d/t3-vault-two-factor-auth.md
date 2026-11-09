### Added

- Vault logins can keep a two-step (authenticator) code. Open a login, select Set up, and paste the
  setup key that the site shows under its QR code, or choose a screenshot of the QR code. OpenBot
  shows the code to enter on the site before you save, then shows the live code next to the login in
  the list; select it to copy it.
- Agents can sign in with a saved two-step code: they enter it with the secure sign-in card, and they
  never see the key. When you ask an agent to turn on two-step verification on a site, it saves the
  site's setup key on that login in the Vault.
- Owners and admins of a joined server see and set up two-step codes of the host's Vault when both
  computers run this version. If you go back to an older OpenBot version, its first change to the
  Vault removes the saved two-step keys. The logins and their passwords stay.
