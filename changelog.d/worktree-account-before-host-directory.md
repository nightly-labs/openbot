### Fixed

- OpenBot reads your joined servers again when it opens before your account finishes loading.
  Before, the first read could stop with "Sign in to OpenBot first.", and the server list did not
  update until a later check. In 0.33.0, OpenBot could fail to start with this error.
