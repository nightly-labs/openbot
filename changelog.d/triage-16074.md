### Fixed

- A busy server with many channels no longer freezes for seconds when an app reads its channel list.
  Before, the server counted the open tasks of every channel again on each read, and joined apps
  could stop responding or disconnect. A joined server gets this fix when the server is on the new
  version.
