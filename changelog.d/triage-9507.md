### Fixed

- When an app such as Mobbin refuses the account that you signed in with, for example because the
  plan of the account does not include access, OpenBot now tells you to sign out and sign in with an
  account that has access. Before, it said "Check the API key or other credentials", also for an
  app that has no API key, and each retry showed the same text. On a joined server, the server must
  also be on this version.
