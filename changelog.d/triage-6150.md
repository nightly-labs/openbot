### Fixed

- On Windows, OpenBot no longer opens a broken earlier copy with "A JavaScript error occurred in the
  main process" after an update. When an update installs OpenBot in a new `OpenBot` subfolder, it now
  removes the earlier copy from the folder above and points "open at sign-in" at the new copy.
