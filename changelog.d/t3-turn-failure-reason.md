### Changed

- Usage reports of a failed turn now include a fixed code for the reason, such as an expired
  sign-in, a usage limit or a context that is too long. The reports never include the error text.

### Fixed

- Run a turn again on the backup model when OpenCode, Pi or Antigravity stops it at a rate limit, a
  usage limit or an expired sign-in. Before, OpenBot did not identify some of these errors and
  showed the error without a try on the backup model.
