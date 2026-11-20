### Fixed

- OpenCode starts when it needs more time to load its plugins, as it can on the first start after an
  update or with many plugins. Before, each start failed with "Internal error: Internal service
  failure" after about 10 seconds, and after three starts OpenBot stopped trying. When OpenCode
  still cannot finish loading, the provider now says "OpenCode did not finish loading in time.
  OpenBot will try again." An agent on a joined server runs on that server, so the server must also
  be on this version.
