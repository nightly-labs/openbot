### Changed

- The desktop app and the browser extension now sign account requests with a short access token
  that lasts about 10 minutes, not with the sign-in token. The account service can then check most
  requests without a database read. Sign-out, account changes, billing, the license and the session
  list still use the sign-in token. With an older account service, the apps use the sign-in token
  as before.
