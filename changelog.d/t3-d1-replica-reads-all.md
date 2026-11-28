### Changed

- The account service reads fewer queries from its main database. Server status, the hosted server
  list, the member list, the credits page and other read requests now read a database copy first. When
  the copy does not have a row yet, the request reads the main database again before it refuses. A
  revoked sign-in or a removed member can still work for at most 60 s.
