### Fixed

- The desktop app no longer closes when a remote server announces a new name and the saved server list
  cannot be written, for example when the profile directory is read-only or the disk is full. The new
  name still appears in the app, and the next write of the list saves it.
