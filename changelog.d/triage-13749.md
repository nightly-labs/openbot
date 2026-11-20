### Fixed

- A provider account no longer shows "Sign-in failed" when only its usage reading fails, for example
  when Claude's usage service refuses too many requests. Before, the account stopped being used for
  account rotation and backups until OpenBot restarted or you signed in again. The account now stays
  connected and keeps its last usage reading. An account that is really signed out still shows it.
