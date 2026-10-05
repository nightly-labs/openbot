### Fixed

- Open Desktop now shows why a remote desktop did not start: Sunshine did not start, Moonlight Web
  did not start, or pairing failed. Before, it showed only "request failed".
- When Sunshine stops on the host, OpenBot ends its remote desktop sessions and starts Sunshine again
  for the next session. Before, each new session stayed at "Connecting".
- Open Desktop shows an error when the host does not start the stream in 60 seconds. Before, it
  stayed at "Connecting" until you closed it.
