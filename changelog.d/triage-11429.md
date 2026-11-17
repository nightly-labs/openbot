### Fixed

- A server with member devices keeps less memory for a device that stops confirming its updates,
  such as a phone with OpenBot in the background or a device on a slow connection. Before, the
  server could keep about 2 GB of updates for each such device, and a busy server could stop with an
  out of memory error. Now that device loads its view again when it comes back, as it did before
  after a long time away.
