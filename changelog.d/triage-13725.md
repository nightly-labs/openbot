### Fixed

- On macOS, agents can fetch from and push to GitHub over HTTPS again while GitHub is connected.
  Before, the sign-in that OpenBot gives to git failed on macOS, so git asked for a user name and
  stopped, or waited with no end.
