### Fixed

- Use less battery and data when a server is offline. The app now waits 15 seconds before the next
  connection try, and doubles the wait up to 5 minutes. Before, each return to the app started 5
  quick tries again. A refresh and a network change still try again at once.
- Ask to wake only hosted servers. Before, the app also asked to wake your own servers when they
  were offline, which could never work.
