### Fixed

- Change the saved login when you add a login in the Vault for a website and username that it
  already has. Before, the Vault kept the old login too, and an agent could sign in with the old
  password and then ask you to take over again and again. The saved login keeps its notes, its
  authenticator key and its agents when you leave them empty. On a joined server, the server must
  also be on the new version.
