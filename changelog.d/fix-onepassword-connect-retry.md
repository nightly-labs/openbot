### Fixed

- Connect 1Password no longer fails with "cannot connect to 1Password app" while the 1Password app
  is open and unlocked. OpenBot now runs one 1Password CLI command at a time, and tries again a few
  times when the 1Password app is busy. When the app still does not answer, OpenBot tells you to
  open and unlock 1Password and to turn on "Integrate with 1Password CLI". Before, it showed the
  error line from the 1Password CLI.
