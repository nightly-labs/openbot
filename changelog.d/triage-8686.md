### Fixed

- Keep a site signed in on a server after you sign in to it on your own computer, also when the site
  keeps the sign-in in the page storage and not in a cookie. Before, OpenBot sent only the cookies,
  so some sites stayed signed out in the server's browser, and the request showed as done. The
  server must also be on this version.
