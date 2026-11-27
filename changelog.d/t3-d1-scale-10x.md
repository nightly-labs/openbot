### Changed

- The account service reads your server list with one database query, and it records the last use of a sign-in at most once an hour. This makes the account service lighter, so it stays fast when many people use OpenBot.
