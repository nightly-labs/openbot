### Changed

- After the network comes back, the web client reads the agent list, channels, account usage and side
  threads one time, not two times. A reconnect sends about 10 fewer requests.
