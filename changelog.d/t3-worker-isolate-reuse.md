### Changed

- The account service does less work for each request. It keeps the parsed server keys and the
  Slack and Discord route keys between requests, and the credits page reads its balances in 1
  database round trip, not 4.
