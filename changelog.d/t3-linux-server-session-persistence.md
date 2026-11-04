### Fixed

- On Linux, OpenBot no longer asks you to sign in again after each restart or update when the system
  keyring does not keep its key, for example a locked keyring or one that keeps its items only in
  memory. Before, the saved sign-in and other secrets did not open after a restart. Now OpenBot
  finds this, keeps new secrets in its own key file that only your user can read, and the sign-in
  screen tells you why you must sign in one more time.
