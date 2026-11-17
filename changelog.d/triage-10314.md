### Fixed

- OpenBot now uses the proxy settings of the computer for its requests to the OpenBot account
  service: sign-in, the list of joined servers, and the ticket that opens a connection to a server.
  Before, these requests went directly and ignored the system proxy. On a network that needs the
  proxy, the server list did not refresh and connections to a server were slow or failed.
