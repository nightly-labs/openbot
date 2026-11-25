### Fixed

- Joined servers: when the OpenBot service answers too slowly while a server opens, the server now
  shows "The OpenBot service did not answer in time. Try again." Before, it showed "The host is not
  reachable." with the code `code/ABORT_ERR`, also when the server was online.
- Sign-in: when the account service answer stops before it is complete, OpenBot now says that the
  service did not answer in time.
