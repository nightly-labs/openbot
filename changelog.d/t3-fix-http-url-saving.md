### Fixed

- The Vault now saves logins for `http://` websites, such as a router or a NAS on your network. An
  agent fills an `http://` login only on a page with the same address and port, and never fills an
  HTTPS login on an `http://` page. Logins in 1Password and Proton Pass follow the same rule. The
  server must also be on the new version.
