### Fixed

- The app connects again to a server on OpenBot v0.34.1 or older. Before, the first request sent too
  many feature names for these servers: a server on v0.20 to v0.34.1 refused each request over a
  direct connection, and an older server ignored the features that the app asked for.
