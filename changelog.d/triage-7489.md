### Fixed

- A joined server accepts other computers again after a short network problem. Before, if the server
  could not reach the OpenBot account service one time, each later connection failed with
  `transport/data_channel_error` until OpenBot restarted on the server.
