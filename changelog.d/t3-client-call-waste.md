### Fixed

- Wait longer before a new connection try when a joined server is offline, on the web client and on
  the desktop. The wait starts at 15 seconds and doubles up to 5 minutes. Before, the client tried
  5 times in 10 seconds after each wait. A refresh and a network change still try again at once.
