### Fixed

- A server with member devices keeps less memory for updates that it sends to them. Before, the
  server kept each update until the device confirmed it, and it could keep about 2 GB of updates for
  a device that did not take them, such as a phone with OpenBot in the background or a device on a
  slow connection. A busy server could then stop with an out of memory error. Now a device that falls
  far behind loads its view again when it catches up, as it did before after a long time away.
