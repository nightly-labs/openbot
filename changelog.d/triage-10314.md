### Fixed

- OpenBot now uses the proxy settings of the computer when it gets the list of joined servers,
  signs in and connects to a server. Before, these requests went directly and ignored the system
  proxy. On a network that needs the proxy, the server list did not refresh and connections were
  slow or failed.
