### Fixed

- The Apple Watch sends messages, answers and approvals again while the iPhone is locked or
  OpenBot on the iPhone is closed. Before, for many servers the watch sent its direct request to
  the wrong Signal server, then waited for the iPhone and showed "iPhone did not answer". The fix
  is in the account service, so the watch app and the servers do not need an update.
