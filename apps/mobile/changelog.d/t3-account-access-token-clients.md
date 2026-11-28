### Changed

- The app now signs account requests with a short access token that lasts about 10 minutes, not
  with the sign-in token. The account service can then check most requests without a database read.
  Sign-out, billing and the session list still use the sign-in token.
