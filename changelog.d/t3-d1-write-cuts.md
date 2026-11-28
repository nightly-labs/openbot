### Fixed

- Sign in, connect to servers and publish sites more reliably at busy times. The account service now
  writes to its database only when a value changes, and it finds old rows with an index. Before,
  computers that registered again, Signal home changes and daily cleanup wrote many rows that did
  not change, and the database sometimes refused requests.
