### Changed

- The account service reads fewer queries from its main database for host and member checks. The
  host credential check of notifications and route tickets, resume validation, the notification
  session check, the server list, the member and invitation lists, the credits page and the pool
  machine poll now read a database copy first. A revoked host key or session can still work for a
  short time: at most 30 s plus the delay of the database copy.
