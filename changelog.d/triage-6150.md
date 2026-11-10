### Fixed

- On Windows, OpenBot no longer opens a broken earlier copy with "A JavaScript error occurred in the
  main process" after an update. When an update installs OpenBot in an `OpenBot` subfolder of the
  default folder, it now removes the earlier copy from the default folder and points "open at
  sign-in" at the new copy.
