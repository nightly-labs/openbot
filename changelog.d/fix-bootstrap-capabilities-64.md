### Fixed

- The desktop app and the web client connect again to a server on OpenBot v0.34.1 or older. Since
  v0.47.0, the first request sent too many feature names for these servers: a server on v0.20 to
  v0.34.1 refused each request over a direct connection, and an older server ignored the features
  that the app asked for. Only the app must be on this version.
