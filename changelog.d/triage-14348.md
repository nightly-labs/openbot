### Fixed

- An update of a self-hosted server with AppArmor 3, for example on Debian 12, no longer shows an
  AppArmor parser error and "The AppArmor profile is not loaded." Such a server does not need the
  profile, so the update now skips it. The update to this release still shows the error one last
  time (#14348).
