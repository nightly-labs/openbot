### Fixed

- Keep ChatGPT agents signed in when several of them start at the same time, for example from
  routines. Before, the sign-in could end with "Your access token could not be refreshed because your
  refresh token was already used", and you had to sign in again. On a joined server, the server must
  also be on this version.
