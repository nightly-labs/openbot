### Fixed

- An agent in an account pool now moves to the next account when Google asks to verify the account in
  use, or when the provider refuses that account's sign-in. Before, the pool chose the same account
  again, so each message failed with "Google must verify your account before Gemini can answer" while
  another account was ready. Now the pool passes over that account for some minutes and sends the
  message again on the next ready account. For an agent on a joined server, the server must also be on
  this version.
