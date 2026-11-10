### Fixed

- On Linux, agents can use the browser while the OpenBot window is hidden, minimized or closed to the
  tray, and in the chats of a local server. Before, pages in those tabs stopped drawing: each
  screenshot timed out after 10 seconds, dialogs that open with an animation never appeared, and
  taking over a tab showed only "Connecting to the page on the server…".
