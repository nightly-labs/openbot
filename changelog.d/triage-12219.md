### Fixed

- Free the memory of a chat after you leave it. Before, when a chat opened while the message box of
  the previous chat had the focus, for example from a notification, the app kept the previous chat in
  memory. After a day, the window could use more than 1 GB and become slow until a restart.
