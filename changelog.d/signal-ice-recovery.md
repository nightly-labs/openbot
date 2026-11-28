### Fixed

- Reconnect the host sooner when its Signal connection stops responding. Before, the host could
  appear offline for several minutes.
- Try the relay once when the web client cannot connect on the public route. Before, it retried
  with the same settings. The relay retry requires an updated host and Signal service.
