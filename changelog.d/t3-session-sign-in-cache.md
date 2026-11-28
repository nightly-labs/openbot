### Changed

- The account service checks a sign-in faster. It keeps a checked sign-in for up to 10 minutes near
  the computer or phone that uses it, and reads the account database only when the sign-in is new
  to that location. A sign-out or a profile change reaches all locations in 60 seconds or less.
