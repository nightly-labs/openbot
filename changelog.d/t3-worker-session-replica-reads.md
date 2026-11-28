### Changed

- The account service reads fewer queries from its main database when an app or the web client
  connects to a server. A connection ticket now needs 1 query, not 2, and the account check of the
  desktop app and the web client reads a database copy when the app knows the last change it made.
