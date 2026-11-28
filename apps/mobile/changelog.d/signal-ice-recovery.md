### Fixed

- Show when a host is offline and connect when it returns. Before, the app had to wait for its
  next connection attempt.
- Try the relay once when the app cannot connect on the public route. If the host requires a
  private network path, show that requirement. Before, both failures showed a generic error.
  The route-specific error and relay retry require an updated host and Signal service.
