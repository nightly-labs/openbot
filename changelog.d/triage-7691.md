### Fixed

- When a custom endpoint refused a turn, OpenBot always said that the endpoint refused its API key or
  headers. The endpoint can also refuse a correct key when its account cannot use the model. Now the
  message names both causes: check the key and the headers in Server settings → Providers, or choose
  another model. On a joined server, the server must also be on this version.
