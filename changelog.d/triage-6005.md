### Fixed

- On macOS, "Update & Restart" no longer quits OpenBot when it cannot install the update because the
  app runs from a read-only location: from its disk image, or from a temporary copy that macOS made
  (App Translocation). Before, OpenBot closed, did not update, and offered the same update again at
  the next start. Now OpenBot stays open and tells you to move it into the Applications folder.
