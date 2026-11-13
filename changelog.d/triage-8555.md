### Fixed

- When Kimi's server does not accept your saved Kimi sign-in, the chat now tells you to sign in with
  Kimi Code. When the server refuses a sign-in that has not expired, Providers also shows Kimi as
  signed out, with its sign-in button. Before, Kimi still showed as signed in, and each message ended
  with "Kimi ended the turn with no answer". A new chat without a saved sign-in also showed
  "RequestError: Authentication required" (#8555). On a joined server, the server must also be on
  this version.
