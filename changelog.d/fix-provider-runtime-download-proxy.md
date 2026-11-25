### Fixed

- Managed provider CLI downloads now use the system proxy and can fall back from a slow IPv6 route
  to IPv4. Before, they connected directly and could stall or fail on a slow network.
