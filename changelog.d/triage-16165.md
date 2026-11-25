### Fixed

- When a browser page goes through a proxy and the connection closes with no answer, the agent and
  the browser now say that the site or the proxy closed it, and tell you to check the proxy settings
  if no site opens. Before, they showed only the technical error "ERR_EMPTY_RESPONSE". A page with
  no proxy keeps the old error. On a joined server, the server must also be on the new version.
