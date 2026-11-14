### Fixed

- When an agent or you save a new password in the Vault for one subdomain, such as
  billing.example.com, OpenBot now adds a new login. The login of another subdomain with the same
  username, such as status.example.com, keeps its password. Before, OpenBot replaced the password of
  that login, and the old password was lost. On a joined server, the server must also be on this
  version.
